import { DEFAULT_FIXED_RULES } from './fixedEngine.js';

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * 校验 JSON 对象是否具备合法顶层结构；若损坏则返回 { valid: false, reason }
 */
export function validateLedgerState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, reason: '顶层数据不是有效的对象' };
  }
  if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion < 1) {
    return { valid: false, reason: '缺少或非法的 schemaVersion' };
  }
  if (!raw.appSettings || typeof raw.appSettings !== 'object') {
    return { valid: false, reason: '缺少 appSettings 配置对象' };
  }
  if (!Array.isArray(raw.categories)) {
    return { valid: false, reason: 'categories 必须为数组' };
  }
  if (!Array.isArray(raw.payees)) {
    return { valid: false, reason: 'payees 必须为数组' };
  }
  if (!Array.isArray(raw.fixedRules)) {
    return { valid: false, reason: 'fixedRules 必须为数组' };
  }
  if (!Array.isArray(raw.expenses)) {
    return { valid: false, reason: 'expenses 必须为数组' };
  }
  if (!raw.tombstones || typeof raw.tombstones !== 'object') {
    return { valid: false, reason: '缺少 tombstones 对象' };
  }
  return { valid: true, reason: null };
}

/**
 * 生成初始默认账本状态
 */
export function createInitialState(startMonth, nowIso = new Date().toISOString(), deviceId = 'local-device') {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appSettings: {
      startMonth,
      alertThresholds: {
        monthlyRegularHkd: '10000.00',
        dailyRegularHkd: '300.00'
      },
      updatedAt: nowIso,
      updatedByDeviceId: deviceId
    },
    categories: [
      { id: 'cat_fixed_monthly', name: '每月固定支出', kind: 'system_fixed', active: true, sortOrder: 0, updatedAt: nowIso },
      { id: 'cat_dining', name: '吃饭', kind: 'normal', active: true, sortOrder: 1, updatedAt: nowIso },
      { id: 'cat_lodging_cn', name: '住宿-内地', kind: 'normal', active: true, sortOrder: 2, updatedAt: nowIso },
      { id: 'cat_travel_hk', name: '出行-香港', kind: 'normal', active: true, sortOrder: 3, updatedAt: nowIso },
      { id: 'cat_travel_cn', name: '出行-内地', kind: 'normal', active: true, sortOrder: 4, updatedAt: nowIso },
      { id: 'cat_trip', name: '旅游', kind: 'normal', active: true, sortOrder: 5, updatedAt: nowIso },
      { id: 'cat_hobby', name: '兴趣爱好', kind: 'normal', active: true, sortOrder: 6, updatedAt: nowIso },
      { id: 'cat_clothes', name: '衣服', kind: 'normal', active: true, sortOrder: 7, updatedAt: nowIso },
      { id: 'cat_home_goods', name: '家居用品', kind: 'normal', active: true, sortOrder: 8, updatedAt: nowIso },
      { id: 'cat_beauty', name: '美美', kind: 'normal', active: true, sortOrder: 9, updatedAt: nowIso },
      { id: 'cat_grocery', name: '水果&超市', kind: 'normal', active: true, sortOrder: 10, updatedAt: nowIso },
      { id: 'cat_study', name: '学习', kind: 'normal', active: true, sortOrder: 11, updatedAt: nowIso },
      { id: 'cat_utilities', name: '水电煤气', kind: 'normal', active: true, sortOrder: 12, updatedAt: nowIso }
    ],
    payees: [
      { id: 'payee_me', name: '我', splitRole: 'me', active: true, sortOrder: 1, updatedAt: nowIso },
      { id: 'payee_dog', name: '小狗', splitRole: 'dog', active: true, sortOrder: 2, updatedAt: nowIso },
      { id: 'payee_me_and_dog', name: '我&小狗', splitRole: 'me_and_dog', active: true, sortOrder: 3, updatedAt: nowIso },
      { id: 'payee_friend', name: '朋友', splitRole: 'other', active: true, sortOrder: 4, updatedAt: nowIso },
      { id: 'payee_family', name: '家人', splitRole: 'other', active: true, sortOrder: 5, updatedAt: nowIso },
      { id: 'payee_relative', name: '亲戚', splitRole: 'other', active: true, sortOrder: 6, updatedAt: nowIso }
    ],
    fixedRules: DEFAULT_FIXED_RULES.map((r) => ({
      ...r,
      updatedAt: nowIso,
      versions: r.versions.map((v) => ({ ...v, createdAt: nowIso }))
    })),
    expenses: [],
    tombstones: {
      expenses: {},
      fixedInstances: {}
    },
    syncMetadata: {
      lastSyncedAt: null,
      remoteRevision: null,
      accountEmailHint: null
    }
  };
}

/**
 * 确定性比较两个 ISO 时间戳：返回 >0 表示 a 更晚，<0 表示 b 更晚，相等时按 tieKey 稳定决胜
 */
function compareTimestamps(tsA, tsB, tieKeyA = '', tieKeyB = '') {
  const a = String(tsA || '');
  const b = String(tsB || '');
  if (a !== b) return a.localeCompare(b);
  return String(tieKeyA).localeCompare(String(tieKeyB));
}

/**
 * 合并按 id 索引的列表实体（categories / payees）
 */
function mergeListById(listA = [], listB = []) {
  const map = new Map();
  for (const item of [...listA, ...listB]) {
    if (!item || !item.id) continue;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, { ...item });
    } else {
      const cmp = compareTimestamps(item.updatedAt, prev.updatedAt, item.id, prev.id);
      if (cmp > 0) {
        map.set(item.id, { ...prev, ...item });
      } else if (cmp === 0) {
        map.set(item.id, { ...item, ...prev });
      }
    }
  }
  return Array.from(map.values());
}

/**
 * 合并固定规则及其版本历史
 */
function mergeFixedRules(rulesA = [], rulesB = []) {
  const map = new Map();
  for (const rule of [...rulesA, ...rulesB]) {
    if (!rule || !rule.ruleKey) continue;
    const prev = map.get(rule.ruleKey);
    if (!prev) {
      map.set(rule.ruleKey, {
        ...rule,
        versions: [...(rule.versions || [])]
      });
    } else {
      const verMap = new Map();
      for (const v of [...(prev.versions || []), ...(rule.versions || [])]) {
        if (!v || !v.versionId) continue;
        const existVer = verMap.get(v.versionId);
        if (!existVer || compareTimestamps(v.createdAt, existVer.createdAt, v.versionId, existVer.versionId) >= 0) {
          verMap.set(v.versionId, { ...v });
        }
      }
      const cmp = compareTimestamps(rule.updatedAt, prev.updatedAt, rule.ruleKey, prev.ruleKey);
      const base = cmp >= 0 ? { ...prev, ...rule } : { ...rule, ...prev };
      map.set(rule.ruleKey, {
        ...base,
        versions: Array.from(verMap.values()).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      });
    }
  }
  return Array.from(map.values());
}

/**
 * 合并本地与云端账本状态
 */
export function mergeLedgerStates(localState, remoteState) {
  const checkLocal = validateLedgerState(localState);
  if (!checkLocal.valid) {
    throw new Error(`本地数据校验失败: ${checkLocal.reason}`);
  }
  const checkRemote = validateLedgerState(remoteState);
  if (!checkRemote.valid) {
    throw new Error(`云端数据校验失败: ${checkRemote.reason}`);
  }

  // 1. 合并墓碑（取并集，若同一 key 均有墓碑则保留较晚删除时间）
  const expTombstones = { ...(remoteState.tombstones?.expenses || {}) };
  for (const [id, tomb] of Object.entries(localState.tombstones?.expenses || {})) {
    const prev = expTombstones[id];
    if (!prev || compareTimestamps(tomb.deletedAt, prev.deletedAt, id, id) >= 0) {
      expTombstones[id] = tomb;
    }
  }

  const fixedTombstones = { ...(remoteState.tombstones?.fixedInstances || {}) };
  for (const [key, tomb] of Object.entries(localState.tombstones?.fixedInstances || {})) {
    const prev = fixedTombstones[key];
    if (!prev || compareTimestamps(tomb.deletedAt, prev.deletedAt, key, key) >= 0) {
      fixedTombstones[key] = tomb;
    }
  }

  // 2. 合并消费记录：墓碑优先于未晚于删除时间的编辑
  const expMap = new Map();
  for (const exp of [...(remoteState.expenses || []), ...(localState.expenses || [])]) {
    if (!exp || !exp.id) continue;
    const tomb = expTombstones[exp.id];
    const fixedTomb = exp.fixedInstanceKey ? fixedTombstones[exp.fixedInstanceKey] : null;
    const effectiveTombAt = tomb?.deletedAt || fixedTomb?.deletedAt || null;

    if (effectiveTombAt && (!exp.updatedAt || exp.updatedAt <= effectiveTombAt)) {
      // 已被删除且无更新于删除之后的修改，跳过或标记删除
      continue;
    }

    const prev = expMap.get(exp.id);
    if (!prev) {
      expMap.set(exp.id, { ...exp });
    } else {
      const cmp = compareTimestamps(exp.updatedAt, prev.updatedAt, exp.id, prev.id);
      if (cmp > 0) {
        expMap.set(exp.id, { ...prev, ...exp });
      } else if (cmp === 0) {
        expMap.set(exp.id, { ...exp, ...prev });
      }
    }
  }

  // 3. 合并 appSettings（startMonth 取较早启用月份，其余设置按 updatedAt 较新者胜出）
  const localSettings = localState.appSettings || {};
  const remoteSettings = remoteState.appSettings || {};
  const useLocalSettings = compareTimestamps(
    localSettings.updatedAt,
    remoteSettings.updatedAt,
    localSettings.updatedByDeviceId || '',
    remoteSettings.updatedByDeviceId || ''
  ) >= 0;

  const earliestStartMonth =
    localSettings.startMonth && remoteSettings.startMonth
      ? (localSettings.startMonth < remoteSettings.startMonth ? localSettings.startMonth : remoteSettings.startMonth)
      : (localSettings.startMonth || remoteSettings.startMonth);

  const mergedSettings = {
    ...(useLocalSettings ? remoteSettings : localSettings),
    ...(useLocalSettings ? localSettings : remoteSettings),
    startMonth: earliestStartMonth
  };

  return {
    schemaVersion: Math.max(localState.schemaVersion, remoteState.schemaVersion, CURRENT_SCHEMA_VERSION),
    appSettings: mergedSettings,
    categories: mergeListById(localState.categories, remoteState.categories),
    payees: mergeListById(localState.payees, remoteState.payees),
    fixedRules: mergeFixedRules(localState.fixedRules, remoteState.fixedRules),
    expenses: Array.from(expMap.values()),
    tombstones: {
      expenses: expTombstones,
      fixedInstances: fixedTombstones
    },
    syncMetadata: {
      ...(remoteState.syncMetadata || {}),
      ...(localState.syncMetadata || {})
    }
  };
}