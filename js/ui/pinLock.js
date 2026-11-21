const PIN_STORAGE_KEY = 'expense_tracker_pin_hash_v1';
const PIN_4_REGEX = /^\d{4}$/;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

/**
 * 使用 Web Crypto API 计算字符串的 SHA-256 小写十六进制摘要
 */
export async function sha256Hex(plainText) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(plainText));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeSha256(value) {
  const cleaned = String(value || '').trim().toLowerCase();
  return SHA256_HEX_REGEX.test(cleaned) ? cleaned : '';
}

/**
 * 获取当前生效的 SHA-256 哈希：优先读取浏览器 localStorage，其次回退到 config 传入值
 */
export function getConfiguredPinHash(fallbackSha256Hex = '') {
  try {
    const localHash = normalizeSha256(localStorage.getItem(PIN_STORAGE_KEY));
    if (localHash) return localHash;
  } catch {
    // 忽略个别受限环境下 localStorage 读取异常，回退到配置值
  }
  return normalizeSha256(fallbackSha256Hex);
}

/**
 * 将新的 4 位数字 PIN 哈希保存到当前浏览器 localStorage
 */
export async function saveLocalPin4(pinInput) {
  const normalizedPin = String(pinInput ?? '').trim();
  if (!PIN_4_REGEX.test(normalizedPin)) {
    return { ok: false, message: '请输入 4 位数字密码（可包含前导零）' };
  }
  const hash = await sha256Hex(normalizedPin);
  try {
    localStorage.setItem(PIN_STORAGE_KEY, hash);
  } catch {
    return { ok: false, message: '无法保存到浏览器本地存储，请检查浏览器存储权限' };
  }
  return { ok: true, hash, message: '' };
}

/**
 * 清除当前浏览器 localStorage 中保存的 PIN 哈希
 */
export function clearLocalPinHash() {
  try {
    localStorage.removeItem(PIN_STORAGE_KEY);
  } catch {
    // 忽略存储清理异常
  }
}

/**
 * 校验 4 位数字 PIN（保留前导零）
 */
export async function verifyPin4(pinInput, expectedSha256Hex) {
  const normalizedPin = String(pinInput ?? '').trim();
  if (!PIN_4_REGEX.test(normalizedPin)) {
    return { ok: false, message: '请输入 4 位数字密码（可包含前导零）' };
  }
  const expected = getConfiguredPinHash(expectedSha256Hex);
  if (!expected) {
    return {
      ok: false,
      message: '尚未设置本地 PIN，请先设置 4 位数字密码'
    };
  }
  const actual = await sha256Hex(normalizedPin);
  if (actual !== expected) {
    return { ok: false, message: '密码错误，请重试' };
  }
  return { ok: true, message: '' };
}

/**
 * 挂载全屏 PIN 锁屏 / 首次设置界面（每次刷新/重新打开均需验证，不持久化解锁状态）
 */
export function mountPinLockOverlay({ expectedSha256Hex, onUnlock }) {
  const existing = document.getElementById('pin-lock-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pin-lock-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: var(--bg-page, #f6f8f3);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  `;

  overlay.innerHTML = `
    <div style="
      width: 100%;
      max-width: 360px;
      background: var(--bg-surface, #ffffff);
      border: 1px solid var(--border-color, #dce5d5);
      border-radius: 16px;
      padding: 24px 20px;
      box-shadow: 0 8px 24px rgba(27, 36, 24, 0.08);
      text-align: center;
    ">
      <h2 id="pin-lock-title" style="margin: 0 0 6px; font-size: 20px; color: var(--text-main, #1b2418);"></h2>
      <p id="pin-lock-desc" style="margin: 0 0 18px; font-size: 13px; color: var(--text-secondary, #4c5c46);"></p>
      <form id="pin-lock-form">
        <input
          id="pin-lock-input"
          type="password"
          inputmode="numeric"
          pattern="\\d{4}"
          maxlength="4"
          autocomplete="off"
          placeholder="••••"
          aria-label="4位数字PIN"
          style="
            width: 100%;
            font-size: 24px;
            letter-spacing: 12px;
            text-align: center;
            padding: 10px 12px;
            border: 1.5px solid var(--border-color, #dce5d5);
            border-radius: 10px;
            color: var(--text-main, #1b2418);
            background: var(--bg-surface-subtle, #eff4ea);
            margin-bottom: 10px;
            box-sizing: border-box;
          "
        />
        <input
          id="pin-lock-confirm"
          type="password"
          inputmode="numeric"
          pattern="\\d{4}"
          maxlength="4"
          autocomplete="off"
          placeholder="再次输入 4 位数字确认"
          aria-label="确认4位数字PIN"
          style="
            display: none;
            width: 100%;
            font-size: 16px;
            letter-spacing: 6px;
            text-align: center;
            padding: 10px 12px;
            border: 1.5px solid var(--border-color, #dce5d5);
            border-radius: 10px;
            color: var(--text-main, #1b2418);
            background: var(--bg-surface-subtle, #eff4ea);
            margin-bottom: 10px;
            box-sizing: border-box;
          "
        />
        <div id="pin-lock-error" style="
          min-height: 20px;
          font-size: 13px;
          color: var(--color-accent-dark, #c4547b);
          margin-bottom: 12px;
        "></div>
        <button
          id="pin-lock-submit"
          type="submit"
          style="
            width: 100%;
            padding: 11px 16px;
            border: none;
            border-radius: 10px;
            background: var(--color-primary, #6a994e);
            color: #ffffff;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
          "
        ></button>
      </form>
      <div id="pin-lock-actions" style="margin-top: 12px;">
        <button
          id="pin-reset-btn"
          type="button"
          style="
            background: none;
            border: none;
            color: var(--text-secondary, #4c5c46);
            font-size: 12px;
            text-decoration: underline;
            cursor: pointer;
            padding: 4px 8px;
          "
        >重置本机 PIN</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const titleEl = overlay.querySelector('#pin-lock-title');
  const descEl = overlay.querySelector('#pin-lock-desc');
  const form = overlay.querySelector('#pin-lock-form');
  const input = overlay.querySelector('#pin-lock-input');
  const confirmInput = overlay.querySelector('#pin-lock-confirm');
  const errEl = overlay.querySelector('#pin-lock-error');
  const submitBtn = overlay.querySelector('#pin-lock-submit');
  const resetBtn = overlay.querySelector('#pin-reset-btn');

  let mode = getConfiguredPinHash(expectedSha256Hex) ? 'unlock' : 'setup';

  function renderMode() {
    errEl.textContent = '';
    input.value = '';
    confirmInput.value = '';
    if (mode === 'setup') {
      titleEl.textContent = '设置本机解锁 PIN';
      descEl.textContent = '首次使用或已重置，请设置 4 位数字 PIN（仅保存在当前浏览器本地）';
      confirmInput.style.display = 'block';
      submitBtn.textContent = '保存并进入';
      resetBtn.style.display = 'none';
    } else {
      titleEl.textContent = '解锁个人记账';
      descEl.textContent = '请输入 4 位数字 PIN（仅作本地界面锁，刷新后需重新输入）';
      confirmInput.style.display = 'none';
      submitBtn.textContent = '解锁进入';
      resetBtn.style.display = 'inline-block';
    }
    setTimeout(() => input.focus(), 30);
  }

  renderMode();

  resetBtn.addEventListener('click', () => {
    clearLocalPinHash();
    mode = 'setup';
    renderMode();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';

    if (mode === 'setup') {
      const pinVal = String(input.value ?? '').trim();
      const confirmVal = String(confirmInput.value ?? '').trim();
      if (!PIN_4_REGEX.test(pinVal)) {
        errEl.textContent = '请输入 4 位数字密码（可包含前导零）';
        input.focus();
        return;
      }
      if (pinVal !== confirmVal) {
        errEl.textContent = '两次输入的 4 位 PIN 不一致，请重新输入';
        confirmInput.value = '';
        confirmInput.focus();
        return;
      }
      const saved = await saveLocalPin4(pinVal);
      if (!saved.ok) {
        errEl.textContent = saved.message;
        return;
      }
      overlay.remove();
      if (typeof onUnlock === 'function') {
        onUnlock();
      }
      return;
    }

    const result = await verifyPin4(input.value, expectedSha256Hex);
    if (!result.ok) {
      errEl.textContent = result.message;
      input.value = '';
      input.focus();
      return;
    }
    overlay.remove();
    if (typeof onUnlock === 'function') {
      onUnlock();
    }
  });
}