import { mergeLedgerStates, validateLedgerState } from '../domain/merge.js';

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

function escapeDriveQueryValue(val) {
  return String(val || '').replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

export class GoogleDriveSyncClient {
  constructor({ clientId, folderName = 'ExpenseTracker', fileName = 'expenses.json', scope }) {
    this.clientId = String(clientId || '').trim();
    this.folderName = folderName;
    this.fileName = fileName;
    this.scope = scope || 'https://www.googleapis.com/auth/drive.file';
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.userEmail = null;
    this.tokenClient = null;
    this.syncInFlight = null;
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientId.includes('.apps.googleusercontent.com'));
  }

  isConnected() {
    return Boolean(this.accessToken && Date.now() < this.tokenExpiresAt - 15_000);
  }

  async ensureGisLoaded() {
    if (window.google?.accounts?.oauth2) return;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('加载 Google 授权脚本失败，请检查网络')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('加载 Google 授权脚本失败，请检查网络'));
      document.head.appendChild(script);
    });
  }

  /**
   * 触发用户交互式 Google OAuth 授权
   */
  async connect({ prompt = 'consent' } = {}) {
    if (!this.isConfigured()) {
      throw new Error('尚未在 js/config.js 中配置有效的 Google OAuth Client ID');
    }
    await this.ensureGisLoaded();

    const tokenResp = await new Promise((resolve, reject) => {
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: `${this.scope} https://www.googleapis.com/auth/userinfo.email`,
        callback: (resp) => {
          if (resp.error) {
            reject(new Error(`Google 授权失败: ${resp.error_description || resp.error}`));
            return;
          }
          resolve(resp);
        },
        error_callback: (err) => {
          reject(new Error(`Google 授权弹窗异常: ${err?.type || '未知错误'}`));
        }
      });
      this.tokenClient.requestAccessToken({ prompt });
    });

    this.accessToken = tokenResp.access_token;
    const expiresInSec = Number(tokenResp.expires_in || 3600);
    this.tokenExpiresAt = Date.now() + expiresInSec * 1000;

    // 获取当前授权账号邮箱，用于按账号隔离本地缓存
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      });
      if (infoRes.ok) {
        const info = await infoRes.json();
        this.userEmail = info.email || null;
      }
    } catch {
      // 忽略邮箱查询失败，回退为默认作用域
    }

    return {
      connected: true,
      userEmail: this.userEmail
    };
  }

  disconnect() {
    if (this.accessToken && window.google?.accounts?.oauth2?.revoke) {
      try {
        window.google.accounts.oauth2.revoke(this.accessToken, () => {});
      } catch {
        // 忽略撤销网络异常
      }
    }
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.userEmail = null;
  }

  async driveFetch(url, options = {}) {
    if (!this.isConnected()) {
      throw new Error('Google 授权已过期或未连接，请重新点击连接授权');
    }
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(options.headers || {})
      }
    });
    if (res.status === 401 || res.status === 403) {
      this.accessToken = null;
      this.tokenExpiresAt = 0;
      throw new Error(`Google Drive 权限或令牌失效 (${res.status})，请重新授权`);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Google Drive 请求失败 (${res.status}): ${errText.slice(0, 160)}`);
    }
    return res;
  }

  /**
   * 查找或创建唯一的 ExpenseTracker 文件夹（检测到同名多个文件夹时报错提示，不静默选错）
   */
  async ensureUniqueFolder() {
    const q = encodeURIComponent(
      `name = '${escapeDriveQueryValue(this.folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    );
    const res = await this.driveFetch(`${DRIVE_FILES_API}?q=${q}&fields=files(id,name,createdTime)&spaces=drive`);
    const data = await res.json();
    const folders = data.files || [];

    if (folders.length > 1) {
      throw new Error(`检测到 Google Drive 中存在 ${folders.length} 个同名文件夹“${this.folderName}”，请先手动清理多余文件夹后再同步。`);
    }
    if (folders.length === 1) {
      return folders[0].id;
    }

    const createRes = await this.driveFetch(DRIVE_FILES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: this.folderName,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const created = await createRes.json();
    return created.id;
  }

  /**
   * 在目标文件夹内查找唯一的 expenses.json（检测到同名多文件时报错提示）
   */
  async findUniqueLedgerFile(folderId) {
    const q = encodeURIComponent(
      `'${escapeDriveQueryValue(folderId)}' in parents and name = '${escapeDriveQueryValue(
        this.fileName
      )}' and trashed = false`
    );
    const res = await this.driveFetch(
      `${DRIVE_FILES_API}?q=${q}&fields=files(id,name,version,headRevisionId,modifiedTime)&spaces=drive`
    );
    const data = await res.json();
    const files = data.files || [];

    if (files.length > 1) {
      throw new Error(`检测到目录“${this.folderName}”下存在 ${files.length} 个同名文件“${this.fileName}”，请手动保留唯一文件后再同步。`);
    }
    return files[0] || null;
  }

  async downloadLedgerJson(fileId) {
    const res = await this.driveFetch(`${DRIVE_FILES_API}/${encodeURIComponent(fileId)}?alt=media`);
    const rawText = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error('云端 expenses.json 文件内容损坏（JSON 解析失败），已停止覆盖云端，请手动检查恢复。');
    }
    const check = validateLedgerState(parsed);
    if (!check.valid) {
      throw new Error(`云端 expenses.json 结构异常（${check.reason}），已停止覆盖云端。`);
    }
    return parsed;
  }

  async createLedgerFile(folderId, state) {
    const metadata = {
      name: this.fileName,
      parents: [folderId],
      mimeType: 'application/json'
    };
    const boundary = `boundary_${Date.now()}`;
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(state, null, 2)}\r\n` +
      `--${boundary}--`;

    const res = await this.driveFetch(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,version,headRevisionId`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    return res.json();
  }

  async overwriteLedgerFile(fileId, state) {
    const res = await this.driveFetch(`${DRIVE_UPLOAD_API}/${encodeURIComponent(fileId)}?uploadType=media&fields=id,version,headRevisionId`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(state, null, 2)
    });
    return res.json();
  }

  /**
   * 串行化同步：先拉取最新云端 -> 合并 -> 上传 -> 写后复核（含有限重试）
   */
  async syncState(localState) {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }
    this.syncInFlight = this._runSyncWithVerify(localState).finally(() => {
      this.syncInFlight = null;
    });
    return this.syncInFlight;
  }

  async _runSyncWithVerify(localState) {
    const folderId = await this.ensureUniqueFolder();
    const existingFile = await this.findUniqueLedgerFile(folderId);

    if (!existingFile) {
      // 首次创建前再次查询一次降低并发双建概率
      const doubleCheck = await this.findUniqueLedgerFile(folderId);
      if (!doubleCheck) {
        const createdMeta = await this.createLedgerFile(folderId, localState);
        const verified = await this.downloadLedgerJson(createdMeta.id);
        return {
          mergedState: verified,
          remoteRevision: createdMeta.headRevisionId || createdMeta.version || null
        };
      }
    }

    let currentLocal = localState;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const targetFile = await this.findUniqueLedgerFile(folderId);
      if (!targetFile) {
        throw new Error('同步过程中云端文件消失，已中止写入以防数据异常。');
      }
      const remoteState = await this.downloadLedgerJson(targetFile.id);
      const merged = mergeLedgerStates(currentLocal, remoteState);

      const updatedMeta = await this.overwriteLedgerFile(targetFile.id, merged);
      // 写后复核：确认云端实际落盘内容包含本地关键实体计数且结构有效
      const readBack = await this.downloadLedgerJson(targetFile.id);
      if ((readBack.expenses || []).length === (merged.expenses || []).length) {
        return {
          mergedState: readBack,
          remoteRevision: updatedMeta.headRevisionId || updatedMeta.version || null
        };
      }
      currentLocal = merged;
    }

    throw new Error('云端并发写入冲突，写后复核重试后仍未一致，请稍后手动同步。');
  }
}