export const SUPPORTED_CURRENCIES = ['HKD', 'CNY', 'USD', 'JPY', 'EUR'];

/**
 * 获取币种默认汇率（多少单位外币 = 1 HKD）
 * HKD 固定 1，CNY 默认 0.85，其余留空由用户手动输入
 */
export function getDefaultExchangeRate(currency) {
  if (currency === 'HKD') return '1';
  if (currency === 'CNY') return '0.85';
  return '';
}

/**
 * 校验非负有限数字字符串
 */
export function parseNonNegativeNumber(value, fieldLabel = '数值') {
  const str = String(value ?? '').trim();
  if (!str || !/^\d+(\.\d+)?$/.test(str)) {
    throw new Error(`${fieldLabel}必须为非负数字`);
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`${fieldLabel}必须为有限非负数`);
  }
  return { str, num };
}

/**
 * 校验汇率：必须为大于 0 的有限数（多少单位外币 = 1 HKD）
 */
export function parsePositiveRate(value) {
  const str = String(value ?? '').trim();
  if (!str || !/^\d+(\.\d+)?$/.test(str)) {
    throw new Error('汇率必须为大于 0 的数字');
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error('汇率必须大于 0');
  }
  return { str, num };
}

/**
 * 将任意带符号数字字符串精确转为整数“分”（四舍五入 half-up）
 */
export function decimalToCents(decimalStr) {
  const str = String(decimalStr ?? '').trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(str);
  if (!match) {
    throw new Error(`非法十进制金额: ${decimalStr}`);
  }
  const sign = match[1] ? -1 : 1;
  const intPart = BigInt(match[2]);
  const fracRaw = match[3] || '';
  const padded = (fracRaw + '000').slice(0, 3);
  let cents = intPart * 100n + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) {
    cents += 1n;
  }
  return sign < 0 ? -cents : cents;
}

/**
 * 将整数“分”（BigInt 或 number）格式化为保留两位小数的字符串（如 "117.65" 或 "-50.00"）
 */
export function centsToDecimal(centsInput) {
  const cents = typeof centsInput === 'bigint' ? centsInput : BigInt(Math.round(Number(centsInput)));
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const frac = String(abs % 100n).padStart(2, '0');
  return `${sign}${whole.toString()}.${frac}`;
}

/**
 * 精确十进制除法并四舍五入到分：HKD = 外币金额 / 汇率
 * 使用 BigInt 定点缩放避免 100 / 0.85 之类的浮点误差
 */
export function convertToHkdCents(originalAmountStr, currency, exchangeRateStr) {
  const { str: amtStr } = parseNonNegativeNumber(originalAmountStr, '原始金额');
  const effectiveRateStr = currency === 'HKD' ? '1' : parsePositiveRate(exchangeRateStr).str;

  const parseScaled = (s) => {
    const [i, f = ''] = s.split('.');
    return { intVal: BigInt(i + f), scale: f.length };
  };

  const a = parseScaled(amtStr);
  const r = parseScaled(effectiveRateStr);

  // 目标结果放大 1000 倍（2位分 + 1位舍入判断位）：(a.intVal * 10^r.scale * 1000) / (r.intVal * 10^a.scale)
  const numerator = a.intVal * (10n ** BigInt(r.scale + 3));
  const denominator = r.intVal * (10n ** BigInt(a.scale));

  const quotient = numerator / denominator;
  const cents = (quotient + 5n) / 10n;
  return cents;
}

export function convertToHkdString(originalAmountStr, currency, exchangeRateStr) {
  return centsToDecimal(convertToHkdCents(originalAmountStr, currency, exchangeRateStr));
}

/**
 * 计算单笔记录统计净额（分）：
 * - 仅普通支出且状态为 reimbursed 时扣减报销金额
 * - 允许净额为负，不截断为 0
 */
export function getExpenseNetCents(expense) {
  const amountCents = decimalToCents(expense.amountHkd);
  if (expense.recordType === 'fixed') {
    return amountCents;
  }
  const reimb = expense.reimbursement || { status: 'unreimbursed', amountHkd: '0.00' };
  if (reimb.status !== 'reimbursed') {
    return amountCents;
  }
  const reimbCents = decimalToCents(reimb.amountHkd || '0.00');
  return amountCents - reimbCents;
}

/**
 * 计算单笔记录在指定支付对象集合下的图表分摊净额（分）：
 * - selectedPayeeIds 为空或包含 'TOTAL' 时：返回 100% 净额
 * - '我'（splitRole === 'me'）：直属 'me' 100% + 'me_and_dog' 50%
 * - '小狗'（splitRole === 'dog'）：直属 'dog' 100% + 'me_and_dog' 50%
 * - 同时选中 'me' 与 'dog'：'me_and_dog' 合计 100%（不重复）
 * - 奇数分确定性余数规则：'me' 得 ceil 侧（带符号向零外/多1分），'dog' 得另一半，确保 me + dog === 原净额
 */
export function getAllocatedNetCentsForChart(expense, selectedPayeeIds, payeesById) {
  const netCents = getExpenseNetCents(expense);
  if (!selectedPayeeIds || selectedPayeeIds.length === 0 || selectedPayeeIds.includes('TOTAL')) {
    return netCents;
  }

  const selectedSet = new Set(selectedPayeeIds);
  const payee = payeesById.get(expense.payeeId);
  if (!payee) return 0n;

  if (payee.splitRole !== 'me_and_dog') {
    return selectedSet.has(payee.id) ? netCents : 0n;
  }

  // 支付对象为“我&小狗”
  const meSelected = Array.from(selectedSet).some((id) => payeesById.get(id)?.splitRole === 'me');
  const dogSelected = Array.from(selectedSet).some((id) => payeesById.get(id)?.splitRole === 'dog');

  if (meSelected && dogSelected) {
    return netCents;
  }
  if (!meSelected && !dogSelected) {
    return 0n;
  }

  // 确定性奇数分分配：meShare + dogShare === netCents
  const half = netCents / 2n;
  const remainder = netCents % 2n; // -1n, 0n, or 1n
  const meShare = half + remainder;
  const dogShare = half;

  return meSelected ? meShare : dogShare;
}