const HK_TIMEZONE = 'Asia/Hong_Kong';

/**
 * 将任意 Date 或 ISO 字符串格式化为香港时区的 YYYY-MM-DD
 */
export function getHkDateString(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * 获取香港当前月份 YYYY-MM
 */
export function getHkYearMonth(dateInput = new Date()) {
  return getHkDateString(dateInput).slice(0, 7);
}

/**
 * 判断闰年
 */
export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 获取指定年月 (year, month 1-12) 的天数
 */
export function getDaysInMonth(year, month) {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}

/**
 * 纯字符串解析 YYYY-MM-DD，避免本地时区偏移
 */
export function parseDateParts(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const maxDay = getDaysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;
  return { year, month, day };
}

/**
 * 纯字符串解析 YYYY-MM
 */
export function parseYearMonthParts(ymStr) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(ymStr || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function formatYearMonth(year, month) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function formatDate(year, month, day) {
  return `${formatYearMonth(year, month)}-${String(day).padStart(2, '0')}`;
}

/**
 * 计算指定 YYYY-MM-DD 的前一天（正确处理跨月、跨年、闰年）
 */
export function getPreviousDateString(dateStr) {
  const parts = parseDateParts(dateStr);
  if (!parts) throw new Error(`非法日期格式: ${dateStr}`);
  let { year, month, day } = parts;
  if (day > 1) {
    return formatDate(year, month, day - 1);
  }
  if (month > 1) {
    const prevMonth = month - 1;
    return formatDate(year, prevMonth, getDaysInMonth(year, prevMonth));
  }
  return formatDate(year - 1, 12, 31);
}

/**
 * 计算指定 YYYY-MM 的上一个月（正确处理跨年）
 */
export function getPreviousYearMonth(ymStr) {
  const parts = parseYearMonthParts(ymStr);
  if (!parts) throw new Error(`非法年月格式: ${ymStr}`);
  const { year, month } = parts;
  if (month > 1) {
    return formatYearMonth(year, month - 1);
  }
  return formatYearMonth(year - 1, 12);
}

/**
 * 计算指定 YYYY-MM 增减 offsetMonths 个月后的 YYYY-MM
 */
export function addMonths(ymStr, offsetMonths) {
  const parts = parseYearMonthParts(ymStr);
  if (!parts) throw new Error(`非法年月格式: ${ymStr}`);
  const total = parts.year * 12 + (parts.month - 1) + offsetMonths;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return formatYearMonth(newYear, newMonth);
}

/**
 * 获取香港今天、昨天、当月、上月上下文
 */
export function getHkCalendarContext(now = new Date()) {
  const today = getHkDateString(now);
  const yesterday = getPreviousDateString(today);
  const currentMonth = today.slice(0, 7);
  const previousMonth = getPreviousYearMonth(currentMonth);
  return { today, yesterday, currentMonth, previousMonth };
}