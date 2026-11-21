import { createInitialState, validateLedgerState } from '../domain/merge.js';
import { getHkYearMonth } from '../domain/hkTime.js';

const DB_NAME = 'ExpenseTrackerLocalDB';
const DB_VERSION = 1;
const STORE_SNAPSHOTS = 'snapshots';
const STORE_META = 'meta';

const GUEST_SCOPE = 'guest';

export function normalizeAccountScope(accountEmail) {
  const cleaned = String(accountEmail || '').trim().toLowerCase();
  return cleaned || GUEST_SCOPE;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'scope' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('打开 IndexedDB 失败'));
  });
}

function txGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function txPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  });
}

export class LocalStore {
  constructor() {
    this.dbPromise = null;
    this.deviceId = null;
    this.activeScope = GUEST_SCOPE;
  }

  async init() {
    if (!this.dbPromise) {
      this.dbPromise = openDb();
    }
    const db = await this.dbPromise;
    const devRec = await txGet(db, STORE_META, 'deviceId');
    if (devRec && devRec.value) {
      this.deviceId = devRec.value;
    } else {
      const generated = `dev_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12)}`;
      await txPut(db, STORE_META, { key: 'deviceId', value: generated });
      this.deviceId = generated;
    }

    const scopeRec = await txGet(db, STORE_META, 'activeScope');
    this.activeScope = normalizeAccountScope(scopeRec?.value);
    return this.activeScope;
  }

  async setActiveScope(accountEmail) {
    const db = await this.dbPromise;
    const nextScope = normalizeAccountScope(accountEmail);
    this.activeScope = nextScope;
    await txPut(db, STORE_META, { key: 'activeScope', value: nextScope });
    return nextScope;
  }

  async loadState(scope = this.activeScope, now = new Date()) {
    const db = await this.dbPromise;
    const cleanScope = normalizeAccountScope(scope);
    const record = await txGet(db, STORE_SNAPSHOTS, cleanScope);

    if (record && record.state) {
      const check = validateLedgerState(record.state);
      if (!check.valid) {
        return {
          state: null,
          hasDirtyLocalChanges: Boolean(record.hasDirtyLocalChanges),
          corruptedReason: check.reason,
          updatedAt: record.updatedAt || null
        };
      }
      return {
        state: record.state,
        hasDirtyLocalChanges: Boolean(record.hasDirtyLocalChanges),
        corruptedReason: null,
        updatedAt: record.updatedAt || null
      };
    }

    const initial = createInitialState(getHkYearMonth(now), new Date(now).toISOString(), this.deviceId);
    await this.saveState(initial, { scope: cleanScope, hasDirtyLocalChanges: false });
    return {
      state: initial,
      hasDirtyLocalChanges: false,
      corruptedReason: null,
      updatedAt: new Date().toISOString()
    };
  }

  async saveState(state, { scope = this.activeScope, hasDirtyLocalChanges = true } = {}) {
    const check = validateLedgerState(state);
    if (!check.valid) {
      throw new Error(`拒绝保存损坏的账本状态: ${check.reason}`);
    }
    const db = await this.dbPromise;
    const cleanScope = normalizeAccountScope(scope);
    const nowIso = new Date().toISOString();
    const payload = {
      scope: cleanScope,
      state,
      hasDirtyLocalChanges: Boolean(hasDirtyLocalChanges),
      updatedAt: nowIso
    };
    await txPut(db, STORE_SNAPSHOTS, payload);
    return payload;
  }

  async markSynced(scope = this.activeScope, remoteRevision = null) {
    const db = await this.dbPromise;
    const cleanScope = normalizeAccountScope(scope);
    const record = await txGet(db, STORE_SNAPSHOTS, cleanScope);
    if (!record || !record.state) return;

    const nextState = {
      ...record.state,
      syncMetadata: {
        ...(record.state.syncMetadata || {}),
        lastSyncedAt: new Date().toISOString(),
        remoteRevision: remoteRevision ?? record.state.syncMetadata?.remoteRevision ?? null,
        accountEmailHint: cleanScope === GUEST_SCOPE ? null : cleanScope
      }
    };

    await txPut(db, STORE_SNAPSHOTS, {
      ...record,
      state: nextState,
      hasDirtyLocalChanges: false,
      updatedAt: new Date().toISOString()
    });
  }
}