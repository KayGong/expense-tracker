import test from 'node:test';
import assert from 'node:assert/strict';

import { getPreviousDateString, getPreviousYearMonth, getHkDateString } from '../js/domain/hkTime.js';
import {
  convertToHkdString,
  getExpenseNetCents,
  getAllocatedNetCentsForChart,
  centsToDecimal
} from '../js/domain/money.js';
import {
  backfillFixedExpenses,
  getEligibleBillingMonths,
  updateFixedRuleWithVersion
} from '../js/domain/fixedEngine.js';
import {
  computeHomeSummaryAndAlerts,
  computeMonthlyCategorySummary,
  filterAndSortMonthlyExpenses
} from '../js/domain/analytics.js';
import { createInitialState, mergeLedgerStates, validateLedgerState } from '../js/domain/merge.js';

test('香港时间跨年与闰年边界', () => {
  assert.equal(getPreviousDateString('2026-01-01'), '2025-12-31');
  assert.equal(getPreviousDateString('2024-03-01'), '2024-02-29');
  assert.equal(getPreviousDateString('2026-03-01'), '2026-02-28');
  assert.equal(getPreviousYearMonth('2026-01'), '2025-12');
  // 2026-11-21 15:58 HKT = 2026-11-21T07:58:00.000Z
  assert.equal(getHkDateString('2026-11-21T07:58:00.000Z'), '2026-11-21');
});

test('汇率换算与报销负净额', () => {
  assert.equal(convertToHkdString('100', 'CNY', '0.85'), '117.65');
  assert.equal(convertToHkdString('250', 'HKD', '1'), '250.00');

  const overReimbursedExp = {
    id: 'e1',
    expenseDate: '2026-10-10',
    recordType: 'normal',
    isIrregular: false,
    amountHkd: '100.00',
    reimbursement: { status: 'reimbursed', amountHkd: '120.00' }
  };
  assert.equal(centsToDecimal(getExpenseNetCents(overReimbursedExp)), '-20.00');
});

test('我 / 小狗 / 我&小狗 分摊与奇数分确定性分配', () => {
  const payeesById = new Map([
    ['payee_me', { id: 'payee_me', splitRole: 'me' }],
    ['payee_dog', { id: 'payee_dog', splitRole: 'dog' }],
    ['payee_both', { id: 'payee_both', splitRole: 'me_and_dog' }]
  ]);

  // 奇数分：1.01 HKD = 101 分，me 得 51 分，dog 得 50 分，合计 101 分
  const oddExp = {
    id: 'e_odd',
    payeeId: 'payee_both',
    recordType: 'normal',
    isIrregular: false,
    amountHkd: '1.01',
    reimbursement: { status: 'unreimbursed', amountHkd: '0.00' }
  };
  const meCents = getAllocatedNetCentsForChart(oddExp, ['payee_me'], payeesById);
  const dogCents = getAllocatedNetCentsForChart(oddExp, ['payee_dog'], payeesById);
  assert.equal(meCents + dogCents, 101n);
  assert.equal(centsToDecimal(meCents), '0.51');
  assert.equal(centsToDecimal(dogCents), '0.50');

  // 同时选我和小狗，不重复计算
  const bothSelectedCents = getAllocatedNetCentsForChart(oddExp, ['payee_me', 'payee_dog'], payeesById);
  assert.equal(bothSelectedCents, 101n);
});

test('固定支出窗口、规则历史版本回溯与墓碑防复活', () => {
  assert.deepEqual(getEligibleBillingMonths('2026-08', '2026-11'), [
    '2026-08',
    '2026-09',
    '2026-10',
    '2026-11'
  ]);

  let state = createInitialState('2026-09', '2026-09-01T00:00:00.000Z');
  // 9月先生成一期 iTunes（8.00）
  const r1 = backfillFixedExpenses(state, new Date('2026-09-16T01:00:00.000Z'));
  state = r1.state;
  const sepItunes = state.expenses.find((e) => e.fixedInstanceKey === 'itunes:2026-09');
  assert.equal(sepItunes.amountHkd, '8.00');

  // 10月1日修改 iTunes 规则金额为 12.00，生效日为 2026-10-01，但不立刻补录 10 月（10月15日才到期）
  const itunesRule = state.fixedRules.find((r) => r.ruleKey === 'itunes');
  const updatedRule = updateFixedRuleWithVersion(
    itunesRule,
    { amountHkd: '12.00' },
    '2026-10-01',
    '2026-10-01T00:00:00.000Z'
  );
  state.fixedRules = state.fixedRules.map((r) => (r.ruleKey === 'itunes' ? updatedRule : r));

  // 到 2026-10-16 补录：9月保持 8.00 不变，10月按新规则生成 12.00
  state = backfillFixedExpenses(state, new Date('2026-10-16T01:00:00.000Z')).state;
  assert.equal(state.expenses.find((e) => e.fixedInstanceKey === 'itunes:2026-09').amountHkd, '8.00');
  assert.equal(state.expenses.find((e) => e.fixedInstanceKey === 'itunes:2026-10').amountHkd, '12.00');

  // 删除 10 月实例并写入墓碑后再次补录，不应复活
  state.expenses = state.expenses.filter((e) => e.fixedInstanceKey !== 'itunes:2026-10');
  state.tombstones.fixedInstances['itunes:2026-10'] = { deletedAt: '2026-10-17T00:00:00.000Z' };
  state = backfillFixedExpenses(state, new Date('2026-10-18T01:00:00.000Z')).state;
  assert.equal(state.expenses.some((e) => e.fixedInstanceKey === 'itunes:2026-10'), false);
});

test('超支预警、负净额饼图降级与损坏数据校验', () => {
  const state = createInitialState('2026-11', '2026-11-21T00:00:00.000Z');
  // 上月（2026-10）常规消费 10200 HKD，超默认阈值 10000 HKD 200.00
  state.expenses.push({
    id: 'exp_oct_1',
    expenseDate: '2026-10-05',
    title: '十月日常',
    categoryId: 'cat_dining',
    payeeId: 'payee_me',
    currency: 'HKD',
    originalAmount: '10200.00',
    exchangeRate: '1',
    amountHkd: '10200.00',
    isIrregular: false,
    reimbursement: { status: 'unreimbursed', amountHkd: '0.00' },
    note: '',
    createdAt: '2026-10-05T01:00:00.000Z',
    updatedAt: '2026-10-05T01:00:00.000Z',
    recordType: 'normal',
    deleted: false
  });

  const summary = computeHomeSummaryAndAlerts(state, new Date('2026-11-21T07:58:00.000Z'));
  assert.equal(summary.alerts.monthlyAlert.message, '2026年10月花超了200.00港币！！！');
  assert.equal(summary.alerts.dailyAlert, null);

  // 11月某类别存在负净额时，月度饼图降级为带符号分类表
  state.expenses.push({
    id: 'exp_nov_neg',
    expenseDate: '2026-11-02',
    title: '超额报销测试',
    categoryId: 'cat_dining',
    payeeId: 'payee_me',
    currency: 'HKD',
    originalAmount: '50.00',
    exchangeRate: '1',
    amountHkd: '50.00',
    isIrregular: false,
    reimbursement: { status: 'reimbursed', amountHkd: '80.00' },
    note: '',
    createdAt: '2026-11-02T01:00:00.000Z',
    updatedAt: '2026-11-02T01:00:00.000Z',
    recordType: 'normal',
    deleted: false
  });
  const catSummary = computeMonthlyCategorySummary(state, { month: '2026-11', selectedPayeeIds: ['TOTAL'] });
  assert.equal(catSummary.canRenderPie, false);
  assert.equal(catSummary.hasNegativeCategory, true);
  assert.equal(catSummary.items[0].netHkd, '-30.00');

  // 损坏数据校验
  assert.equal(validateLedgerState(null).valid, false);
  assert.throws(() => mergeLedgerStates(state, { schemaVersion: 1 }));
});