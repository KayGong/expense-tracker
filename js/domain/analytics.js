import { getHkCalendarContext } from './hkTime.js';
import {
  centsToDecimal,
  decimalToCents,
  getAllocatedNetCentsForChart,
  getExpenseNetCents
} from './money.js';

/**
 * 判定记录所属的统计桶：'fixed' | 'irregular' | 'regular'
 */
export function classifyExpenseBucket(expense) {
  if (expense.recordType === 'fixed') return 'fixed';
  if (expense.isIrregular) return 'irregular';
  return 'regular';
}

/**
 * 计算 Home 页面的六张汇总卡与超支预警（统一按香港时间）
 */
export function computeHomeSummaryAndAlerts(state, now = new Date()) {
  const { today, yesterday, currentMonth, previousMonth } = getHkCalendarContext(now);
  const activeExpenses = (state.expenses || []).filter((e) => !e.deleted);

  let todayRegularCents = 0n;
  let todayIrregularCents = 0n;
  let monthRegularCents = 0n;
  let monthIrregularCents = 0n;
  let monthFixedCents = 0n;

  let yesterdayRegularCents = 0n;
  let prevMonthRegularCents = 0n;

  for (const exp of activeExpenses) {
    const bucket = classifyExpenseBucket(exp);
    const netCents = getExpenseNetCents(exp);
    const expMonth = (exp.expenseDate || '').slice(0, 7);

    if (exp.expenseDate === today) {
      if (bucket === 'regular') todayRegularCents += netCents;
      else if (bucket === 'irregular') todayIrregularCents += netCents;
    }

    if (expMonth === currentMonth) {
      if (bucket === 'regular') monthRegularCents += netCents;
      else if (bucket === 'irregular') monthIrregularCents += netCents;
      else if (bucket === 'fixed') monthFixedCents += netCents;
    }

    if (exp.expenseDate === yesterday && bucket === 'regular') {
      yesterdayRegularCents += netCents;
    }

    if (expMonth === previousMonth && bucket === 'regular') {
      prevMonthRegularCents += netCents;
    }
  }

  const monthTotalCents = monthRegularCents + monthIrregularCents + monthFixedCents;

  const monthlyThresholdCents = decimalToCents(
    state.appSettings?.alertThresholds?.monthlyRegularHkd || '10000.00'
  );
  const dailyThresholdCents = decimalToCents(
    state.appSettings?.alertThresholds?.dailyRegularHkd || '300.00'
  );

  let monthlyAlert = null;
  if (prevMonthRegularCents > monthlyThresholdCents) {
    const excess = centsToDecimal(prevMonthRegularCents - monthlyThresholdCents);
    const [py, pm] = previousMonth.split('-');
    monthlyAlert = {
      type: 'monthly',
      yearMonth: previousMonth,
      excessHkd: excess,
      message: `${py}年${pm}月花超了${excess}港币！！！`
    };
  }

  let dailyAlert = null;
  if (yesterdayRegularCents > dailyThresholdCents) {
    const excess = centsToDecimal(yesterdayRegularCents - dailyThresholdCents);
    const [yy, ym, yd] = yesterday.split('-');
    dailyAlert = {
      type: 'daily',
      date: yesterday,
      excessHkd: excess,
      message: `${yy}年${ym}月${yd}日花超了${excess}港币！！！`
    };
  }

  return {
    calendar: { today, yesterday, currentMonth, previousMonth },
    cards: {
      todayRegularHkd: centsToDecimal(todayRegularCents),
      todayIrregularHkd: centsToDecimal(todayIrregularCents),
      monthRegularHkd: centsToDecimal(monthRegularCents),
      monthIrregularHkd: centsToDecimal(monthIrregularCents),
      monthFixedHkd: centsToDecimal(monthFixedCents),
      monthTotalHkd: centsToDecimal(monthTotalCents)
    },
    alerts: {
      monthlyAlert,
      dailyAlert
    }
  };
}

/**
 * 月记录筛选与升序排序（交集过滤；金额下限按原始换算 HKD 判断；支付对象按原始支付对象筛选）
 */
export function filterAndSortMonthlyExpenses(expenses, filters = {}) {
  const {
    month,
    payeeId = 'ALL',
    categoryId = 'ALL',
    minAmountHkd = '',
    keyword = ''
  } = filters;

  const hasMin = String(minAmountHkd ?? '').trim() !== '';
  const minCents = hasMin ? decimalToCents(String(minAmountHkd).trim()) : null;
  const kw = String(keyword || '').trim().toLowerCase();

  return (expenses || [])
    .filter((exp) => {
      if (exp.deleted) return false;
      if (month && (exp.expenseDate || '').slice(0, 7) !== month) return false;
      if (payeeId && payeeId !== 'ALL' && exp.payeeId !== payeeId) return false;
      if (categoryId && categoryId !== 'ALL' && exp.categoryId !== categoryId) return false;
      if (hasMin) {
        const rawHkdCents = decimalToCents(exp.amountHkd);
        if (rawHkdCents < minCents) return false;
      }
      if (kw) {
        const titleMatch = (exp.title || '').toLowerCase().includes(kw);
        const noteMatch = (exp.note || '').toLowerCase().includes(kw);
        if (!titleMatch && !noteMatch) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.expenseDate !== b.expenseDate) {
        return a.expenseDate.localeCompare(b.expenseDate);
      }
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
}

/**
 * 月度分类汇总与饼图降级判定
 */
export function computeMonthlyCategorySummary(state, { month, selectedPayeeIds = ['TOTAL'] }) {
  const payeesById = new Map((state.payees || []).map((p) => [p.id, p]));
  const categoriesById = new Map((state.categories || []).map((c) => [c.id, c]));

  const totalsByCat = new Map();

  for (const exp of state.expenses || []) {
    if (exp.deleted) continue;
    if ((exp.expenseDate || '').slice(0, 7) !== month) continue;

    const allocatedCents = getAllocatedNetCentsForChart(exp, selectedPayeeIds, payeesById);
    if (allocatedCents === 0n) continue;

    const catId = exp.recordType === 'fixed' ? 'cat_fixed_monthly' : exp.categoryId;
    totalsByCat.set(catId, (totalsByCat.get(catId) || 0n) + allocatedCents);
  }

  const items = [];
  let totalNetCents = 0n;
  let hasNegativeCategory = false;

  for (const [catId, netCents] of totalsByCat.entries()) {
    if (netCents === 0n) continue;
    if (netCents < 0n) hasNegativeCategory = true;
    totalNetCents += netCents;
    const cat = categoriesById.get(catId);
    items.push({
      categoryId: catId,
      categoryName: cat ? cat.name : (catId === 'cat_fixed_monthly' ? '每月固定支出' : catId),
      sortOrder: cat ? cat.sortOrder : 999,
      netCents,
      netHkd: centsToDecimal(netCents)
    });
  }

  items.sort((a, b) => {
    if (a.netCents !== b.netCents) return a.netCents > b.netCents ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });

  const isEmpty = items.length === 0 || (totalNetCents === 0n && !hasNegativeCategory);
  const canRenderPie = !isEmpty && !hasNegativeCategory && totalNetCents > 0n;

  const itemsWithShare = items.map((item) => {
    let percentage = null;
    if (canRenderPie) {
      const pctTimes10 = (item.netCents * 1000n + totalNetCents / 2n) / totalNetCents;
      percentage = `${(Number(pctTimes10) / 10).toFixed(1)}%`;
    }
    return {
      ...item,
      percentage
    };
  });

  return {
    month,
    isEmpty,
    canRenderPie,
    hasNegativeCategory,
    fallbackReason: hasNegativeCategory
      ? '因部分类别存在超额报销导致净额为负，饼图无法准确表达负占比，已自动切换为带符号分类金额表。'
      : null,
    totalNetHkd: centsToDecimal(totalNetCents),
    items: itemsWithShare
  };
}

/**
 * 年度 12 个月合计柱状图聚合（X 轴固定 01-12 月）
 */
export function computeAnnualMonthlyBars(
  state,
  { year, selectedCategoryIds = null, selectedPayeeIds = ['TOTAL'] }
) {
  const payeesById = new Map((state.payees || []).map((p) => [p.id, p]));
  const catFilterSet = selectedCategoryIds && selectedCategoryIds.length > 0
    ? new Set(selectedCategoryIds)
    : null;

  const monthCents = Array(12).fill(0n);

  for (const exp of state.expenses || []) {
    if (exp.deleted) continue;
    if (!exp.expenseDate || !exp.expenseDate.startsWith(`${year}-`)) continue;

    const effectiveCatId = exp.recordType === 'fixed' ? 'cat_fixed_monthly' : exp.categoryId;
    if (catFilterSet && !catFilterSet.has(effectiveCatId)) continue;

    const allocatedCents = getAllocatedNetCentsForChart(exp, selectedPayeeIds, payeesById);
    const monthIdx = Number(exp.expenseDate.slice(5, 7)) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      monthCents[monthIdx] += allocatedCents;
    }
  }

  return monthCents.map((cents, idx) => ({
    monthIndex: idx + 1,
    label: `${idx + 1}月`,
    yearMonth: `${year}-${String(idx + 1).padStart(2, '0')}`,
    netCents: cents,
    netHkd: centsToDecimal(cents),
    netNumber: Number(centsToDecimal(cents))
  }));
}