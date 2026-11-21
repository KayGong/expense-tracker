import {
  addMonths,
  formatDate,
  getDaysInMonth,
  getHkDateString,
  parseDateParts,
  parseYearMonthParts
} from './hkTime.js';
import { centsToDecimal, decimalToCents } from './money.js';

export const DEFAULT_FIXED_RULES = [
  {
    ruleKey: 'rent',
    defaultTitle: '住宿-香港',
    categoryId: 'cat_fixed_monthly',
    payeeId: 'payee_me',
    currency: 'HKD',
    dueDayRule: 'last_day_of_month',
    endDate: null,
    updatedAt: '2026-11-01T00:00:00.000Z',
    versions: [
      {
        versionId: 'ver_rent_init',
        effectiveFrom: '2024-07-01',
        amountHkd: '14000.00',
        dueDayRule: 'last_day_of_month',
        endDate: null,
        createdAt: '2026-11-01T00:00:00.000Z'
      }
    ]
  },
  {
    ruleKey: 'itunes',
    defaultTitle: '订阅 iTunes',
    categoryId: 'cat_fixed_monthly',
    payeeId: 'payee_me',
    currency: 'HKD',
    dueDayRule: 'day_of_month:15',
    endDate: null,
    updatedAt: '2026-11-01T00:00:00.000Z',
    versions: [
      {
        versionId: 'ver_itunes_init',
        effectiveFrom: '2022-01-01',
        amountHkd: '8.00',
        dueDayRule: 'day_of_month:15',
        endDate: null,
        createdAt: '2026-11-01T00:00:00.000Z'
      }
    ]
  },
  {
    ruleKey: 'loan1',
    defaultTitle: '贷款一',
    categoryId: 'cat_fixed_monthly',
    payeeId: 'payee_me',
    currency: 'HKD',
    dueDayRule: 'day_of_month:20',
    endDate: '2027-11-20',
    updatedAt: '2026-11-01T00:00:00.000Z',
    versions: [
      {
        versionId: 'ver_loan1_init',
        effectiveFrom: '2026-05-19',
        amountHkd: '5905.60',
        dueDayRule: 'day_of_month:20',
        endDate: '2027-11-20',
        createdAt: '2026-11-01T00:00:00.000Z'
      }
    ]
  },
  {
    ruleKey: 'loan2',
    defaultTitle: '贷款二',
    categoryId: 'cat_fixed_monthly',
    payeeId: 'payee_me',
    currency: 'HKD',
    dueDayRule: 'day_of_month:20',
    endDate: '2029-12-20',
    updatedAt: '2026-11-01T00:00:00.000Z',
    versions: [
      {
        versionId: 'ver_loan2_init',
        effectiveFrom: '2026-12-19',
        amountHkd: '8654.63',
        dueDayRule: 'day_of_month:20',
        endDate: '2029-12-20',
        createdAt: '2026-11-01T00:00:00.000Z'
      }
    ]
  }
];

/**
 * 根据归属月份 YYYY-MM 与到期日规则计算该月的具体到期日 YYYY-MM-DD
 */
export function resolveDueDateForMonth(billingMonth, dueDayRule) {
  const ym = parseYearMonthParts(billingMonth);
  if (!ym) throw new Error(`非法归属月份: ${billingMonth}`);
  const maxDay = getDaysInMonth(ym.year, ym.month);

  if (dueDayRule === 'last_day_of_month') {
    return formatDate(ym.year, ym.month, maxDay);
  }
  const match = /^day_of_month:(\d{1,2})$/.exec(String(dueDayRule || ''));
  if (!match) throw new Error(`非法到期日规则: ${dueDayRule}`);
  const targetDay = Math.min(Math.max(1, Number(match[1])), maxDay);
  return formatDate(ym.year, ym.month, targetDay);
}

/**
 * 在规则版本列表中查找在某天（或该月）适用的版本：
 * 优先匹配 effectiveFrom <= 目标到期日 的最新版本；若均晚于目标日期则取最早版本
 */
export function pickEffectiveRuleVersion(rule, billingMonth) {
  const versions = [...(rule.versions || [])].sort((a, b) => {
    if (a.effectiveFrom !== b.effectiveFrom) {
      return a.effectiveFrom.localeCompare(b.effectiveFrom);
    }
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
  if (versions.length === 0) {
    throw new Error(`固定规则 ${rule.ruleKey} 缺少版本配置`);
  }

  let chosen = null;
  for (const ver of versions) {
    const dueDate = resolveDueDateForMonth(billingMonth, ver.dueDayRule);
    if (ver.effectiveFrom <= dueDate) {
      chosen = ver;
    }
  }
  return chosen;
}

/**
 * 计算回补月份列表：
 * - 窗口上限为香港当前月份 currentMonth
 * - 窗口下限为 max(startMonth, addMonths(currentMonth, -11))（共滚动过去 12 个日历月，且不早于启用月份）
 */
export function getEligibleBillingMonths(startMonth, currentMonth) {
  if (!startMonth || startMonth > currentMonth) return [];
  const rollingFloor = addMonths(currentMonth, -11);
  const effectiveStart = startMonth > rollingFloor ? startMonth : rollingFloor;

  const months = [];
  let cursor = effectiveStart;
  while (cursor <= currentMonth) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

/**
 * 补录缺失的已到期固定支出实例（纯函数，返回新状态与新增条数）
 */
export function backfillFixedExpenses(state, now = new Date()) {
  const todayHk = getHkDateString(now);
  const currentMonth = todayHk.slice(0, 7);
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  const startMonth = state.appSettings?.startMonth || currentMonth;
  const eligibleMonths = getEligibleBillingMonths(startMonth, currentMonth);

  const existingInstanceKeys = new Set(
    (state.expenses || [])
      .filter((e) => e.fixedInstanceKey)
      .map((e) => e.fixedInstanceKey)
  );
  const tombstones = state.tombstones?.fixedInstances || {};

  const generated = [];

  for (const rule of state.fixedRules || []) {
    for (const billingMonth of eligibleMonths) {
      const instanceKey = `${rule.ruleKey}:${billingMonth}`;
      if (existingInstanceKeys.has(instanceKey) || tombstones[instanceKey]) {
        continue;
      }

      const ver = pickEffectiveRuleVersion(rule, billingMonth);
      if (!ver) {
        continue;
      }
      const dueDate = resolveDueDateForMonth(billingMonth, ver.dueDayRule);

      // 未到期不生成
      if (dueDate > todayHk) {
        continue;
      }

      // 超过最后一期截止日不生成（含当日）
      const effectiveEndDate = ver.endDate !== undefined ? ver.endDate : rule.endDate;
      if (effectiveEndDate && dueDate > effectiveEndDate) {
        continue;
      }

      const amountStr = centsToDecimal(decimalToCents(ver.amountHkd));
      generated.push({
        id: `fixed_${rule.ruleKey}_${billingMonth}`,
        expenseDate: dueDate,
        title: rule.defaultTitle,
        categoryId: rule.categoryId || 'cat_fixed_monthly',
        payeeId: rule.payeeId || 'payee_me',
        currency: 'HKD',
        originalAmount: amountStr,
        exchangeRate: '1',
        amountHkd: amountStr,
        isIrregular: false,
        reimbursement: {
          status: 'unreimbursed',
          amountHkd: '0.00'
        },
        note: '',
        createdAt: nowIso,
        updatedAt: nowIso,
        recordType: 'fixed',
        fixedRuleKey: rule.ruleKey,
        fixedInstanceKey: instanceKey,
        billingMonth,
        deleted: false,
        deletedAt: null
      });
      existingInstanceKeys.add(instanceKey);
    }
  }

  if (generated.length === 0) {
    return {
      state: {
        ...state,
        appSettings: {
          ...state.appSettings,
          startMonth
        }
      },
      generatedCount: 0
    };
  }

  return {
    state: {
      ...state,
      appSettings: {
        ...state.appSettings,
        startMonth
      },
      expenses: [...(state.expenses || []), ...generated]
    },
    generatedCount: generated.length
  };
}

/**
 * 更新固定支出规则并追加版本记录（仅对 effectiveFrom 之后的实例生效，不修改历史）
 */
export function updateFixedRuleWithVersion(rule, updates, effectiveFromDate, nowIso = new Date().toISOString()) {
  if (!parseDateParts(effectiveFromDate)) {
    throw new Error(`非法生效日期: ${effectiveFromDate}`);
  }
  const latestVer = pickEffectiveRuleVersion(rule, effectiveFromDate.slice(0, 7));
  const newAmount = updates.amountHkd !== undefined
    ? centsToDecimal(decimalToCents(updates.amountHkd))
    : latestVer.amountHkd;
  const newDueDayRule = updates.dueDayRule !== undefined ? updates.dueDayRule : latestVer.dueDayRule;
  const newEndDate = updates.endDate !== undefined ? updates.endDate : latestVer.endDate;

  const newVersion = {
    versionId: `ver_${rule.ruleKey}_${Date.now()}`,
    effectiveFrom: effectiveFromDate,
    amountHkd: newAmount,
    dueDayRule: newDueDayRule,
    endDate: newEndDate,
    createdAt: nowIso
  };

  // 若同一天多次修改，替换同日版本，保留更早日期的旧版本
  const keptVersions = (rule.versions || []).filter((v) => v.effectiveFrom !== effectiveFromDate);

  return {
    ...rule,
    dueDayRule: newDueDayRule,
    endDate: newEndDate,
    updatedAt: nowIso,
    versions: [...keptVersions, newVersion]
  };
}