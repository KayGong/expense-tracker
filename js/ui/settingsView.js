import { filterAndSortMonthlyExpenses } from '../domain/analytics.js';
import { updateFixedRuleWithVersion } from '../domain/fixedEngine.js';
import { getHkDateString } from '../domain/hkTime.js';
import {
  centsToDecimal,
  decimalToCents,
  getExpenseNetCents,
  parseNonNegativeNumber
} from '../domain/money.js';
import { escapeHtml, formatHkDisplayTime } from './recordsView.js';
import { formatSyncStatusLabel } from './homeView.js';

// 锁定 SheetJS 版本（不使用 latest）
export const LOCKED_XLSX_VERSION = '0.20.3';
export const LOCKED_XLSX_URL = `https://cdn.sheetjs.com/xlsx-${LOCKED_XLSX_VERSION}/package/dist/xlsx.full.min.js`;

/**
 * 防 Excel 公式注入：文本单元格若以 =, +, -, @, \t, \r 开头，前缀单引号转义
 */
export function sanitizeExcelText(val) {
  const str = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function formatDueDayLabel(dueDayRule) {
  if (dueDayRule === 'last_day_of_month') return '每月最后一天';
  const m = /^day_of_month:(\d{1,2})$/.exec(String(dueDayRule || ''));
  return m ? `每月 ${m[1]} 日` : dueDayRule;
}

export function exportFilteredExpensesToXlsx(state, filters) {
  if (typeof window.XLSX === 'undefined') {
    throw new Error('Excel 导出库（SheetJS）尚未加载完成，请联网刷新后重试');
  }

  const records = filterAndSortMonthlyExpenses(state.expenses, filters);
  const catMap = new Map((state.categories || []).map((c) => [c.id, c]));
  const payeeMap = new Map((state.payees || []).map((p) => [p.id, p]));

  const statusText = (s) => (s === 'reimbursed' ? '已报销' : s === 'applied' ? '已申请' : '未报销');

  const headers = [
    '日期',
    '项目',
    '类别',
    '支付对象',
    '币种',
    '原始金额',
    '汇率',
    'HKD金额',
    '非常规标记',
    '报销状态',
    '报销金额',
    '净额',
    '备注',
    '创建时间'
  ];

  const rows = records.map((exp) => {
    const isFixed = exp.recordType === 'fixed';
    const reimbStatus = isFixed ? 'unreimbursed' : exp.reimbursement?.status || 'unreimbursed';
    const reimbNum =
      !isFixed && reimbStatus === 'reimbursed'
        ? Number(centsToDecimal(decimalToCents(exp.reimbursement?.amountHkd || '0.00')))
        : 0;
    const netNum = Number(centsToDecimal(getExpenseNetCents(exp)));

    return [
      sanitizeExcelText(exp.expenseDate),
      sanitizeExcelText(exp.title),
      sanitizeExcelText(catMap.get(exp.categoryId)?.name || exp.categoryId),
      sanitizeExcelText(payeeMap.get(exp.payeeId)?.name || exp.payeeId),
      sanitizeExcelText(exp.currency),
      Number(exp.originalAmount),
      Number(exp.exchangeRate),
      Number(exp.amountHkd),
      isFixed ? '固定支出' : exp.isIrregular ? '是' : '否',
      isFixed ? '不可报销' : statusText(reimbStatus),
      reimbNum,
      netNum,
      sanitizeExcelText(exp.note || ''),
      sanitizeExcelText(formatHkDisplayTime(exp.createdAt))
    ];
  });

  const worksheet = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // 金额与数字列（索引 5:原始金额, 7:HKD金额, 10:报销金额, 11:净额）设置两位小数数字格式
  const moneyCols = [5, 7, 10, 11];
  for (let r = 1; r <= rows.length; r++) {
    for (const c of moneyCols) {
      const cellRef = window.XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[cellRef];
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n';
        cell.z = '0.00';
      }
    }
  }

  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, '支出明细');

  const safeMonth = String(filters.month || 'export').replace(/[^0-9-]/g, '');
  const filename = `expenses_${safeMonth || 'export'}.xlsx`;
  window.XLSX.writeFile(workbook, filename);
  return { filename, count: records.length };
}

export function renderSettingsPage({
  state,
  hasDirtyLocalChanges,
  syncUiState,
  monthlyFilters,
  now = new Date()
}) {
  const todayHk = getHkDateString(now);
  const syncInfo = formatSyncStatusLabel(syncUiState, hasDirtyLocalChanges);
  const filteredPreview = filterAndSortMonthlyExpenses(state.expenses, monthlyFilters);

  const normalCategories = (state.categories || []).filter((c) => c.kind === 'normal');
  const allPayees = state.payees || [];
  const thresholds = state.appSettings?.alertThresholds || {
    monthlyRegularHkd: '10000.00',
    dailyRegularHkd: '300.00'
  };

  return `
    <section class="card settings-section">
      <h2>Google Drive 云端同步</h2>
      <p class="hint-text">
        云端路径固定为 <code>ExpenseTracker/expenses.json</code>（仅申请最小 <code>drive.file</code> 权限）。
        离线时可正常记账，但浏览器清理缓存可能导致未同步的本地 IndexedDB 数据丢失，请及时连接云端同步。
      </p>
      <div class="sync-banner-box">
        <div><strong>当前状态：</strong>${escapeHtml(syncInfo.text)}</div>
        ${
          syncUiState?.userEmail
            ? `<div class="hint-text">当前已授权账号：${escapeHtml(syncUiState.userEmail)}</div>`
            : ''
        }
        ${
          state.syncMetadata?.lastSyncedAt
            ? `<div class="hint-text">最近成功同步（香港时间）：${escapeHtml(
                formatHkDisplayTime(state.syncMetadata.lastSyncedAt)
              )}</div>`
            : ''
        }
      </div>
      <div class="btn-row">
        <button type="button" class="btn-primary" id="drive-connect-btn">
          ${syncUiState?.connected ? '重新授权 / 切换账号' : '连接 Google Drive'}
        </button>
        <button type="button" class="btn-secondary" id="settings-sync-btn" ${
          syncUiState?.connected ? '' : 'disabled'
        }>立即同步</button>
        <button type="button" class="btn-danger-outline" id="drive-disconnect-btn" ${
          syncUiState?.connected ? '' : 'disabled'
        }>断开连接（保留本地待同步数据）</button>
      </div>
    </section>

    <section class="card settings-section">
      <h2>Excel 导出（XLSX）</h2>
      <p class="hint-text">
        复用“月记录”页面的当前筛选条件，仅导出当前筛选结果（工作表：<code>支出明细</code>）。
      </p>
      <div class="export-summary-box">
        当前导出月份：<strong>${escapeHtml(monthlyFilters.month)}</strong> ｜ 符合当前筛选条件：<strong>${
    filteredPreview.length
  }</strong> 条
      </div>
      <button type="button" class="btn-primary" id="export-xlsx-btn">导出当前筛选结果为 XLSX</button>
    </section>

    <section class="card settings-section">
      <h2>超支预警阈值（仅常规支出净额）</h2>
      <form id="thresholds-form" class="form-row-2">
        <label>
          <span>月度常规支出阈值（HKD）</span>
          <input type="text" name="monthlyRegularHkd" value="${escapeHtml(thresholds.monthlyRegularHkd)}" required />
        </label>
        <label>
          <span>每日常规支出阈值（HKD）</span>
          <input type="text" name="dailyRegularHkd" value="${escapeHtml(thresholds.dailyRegularHkd)}" required />
        </label>
        <div class="filter-span-2">
          <button type="submit" class="btn-primary">保存预警阈值</button>
        </div>
      </form>
    </section>

    <section class="card settings-section">
      <h2>四项固定支出规则管理</h2>
      <p class="hint-text">
        修改规则仅对生效日期之后的未生成实例起作用，不会修改历史记录；如需停止未来生成，可设置最后一期截止日期。删除某月已生成固定记录请前往“月记录”操作。
      </p>
      <div class="fixed-rules-list">
            ${(state.fixedRules || [])
              .map((rule) => {
                const latestVer = rule.versions[rule.versions.length - 1];
                const isLastDay = latestVer.dueDayRule === 'last_day_of_month';
                const dayNum = isLastDay ? '' : latestVer.dueDayRule.split(':')[1] || '15';
                const currentEffectiveFrom = latestVer.effectiveFrom || todayHk;
                return `
                  <form class="fixed-rule-card" data-rule-key="${escapeHtml(rule.ruleKey)}">
                    <div class="fixed-rule-head">
                      <strong>${escapeHtml(rule.defaultTitle)}</strong>
                      <span class="hint-text">当前生效自：${escapeHtml(currentEffectiveFrom)} · ${escapeHtml(
                  formatDueDayLabel(latestVer.dueDayRule)
                )} · ${escapeHtml(latestVer.amountHkd)} HKD（共 ${rule.versions.length} 个版本）</span>
                    </div>
                    <div class="form-row-2">
                      <label>
                        <span>金额（HKD）</span>
                        <input type="text" name="amountHkd" value="${escapeHtml(latestVer.amountHkd)}" required />
                      </label>
                      <label>
                        <span>生效日期</span>
                        <input type="date" name="effectiveFrom" value="${escapeHtml(currentEffectiveFrom)}" required />
                      </label>
                    </div>
                    <div class="form-row-2">
                      <label>
                        <span>到期日类型</span>
                        <select name="dueType" class="rule-due-type">
                          <option value="last_day" ${isLastDay ? 'selected' : ''}>每月最后一天</option>
                          <option value="day" ${!isLastDay ? 'selected' : ''}>每月指定日（1-31）</option>
                        </select>
                      </label>
                      <label>
                        <span>每月几号（指定日时填写）</span>
                        <input type="number" min="1" max="31" name="dueDay" value="${escapeHtml(dayNum)}" ${
                  isLastDay ? 'disabled' : ''
                } />
                      </label>
                    </div>
                    <label>
                      <span>最后一期截止日期（留空表示长期有效）</span>
                      <input type="date" name="endDate" value="${escapeHtml(latestVer.endDate || '')}" />
                    </label>
                    <button type="submit" class="btn-secondary btn-sm">保存此规则新版本</button>
                  </form>
                `;
              })
              .join('')}
          </div>
    </section>

    <section class="card settings-section">
      <h2>普通类别管理</h2>
      <p class="hint-text">系统保留类别“每月固定支出”不可在此新增或修改；已被历史记录引用的类别删除时自动转为停用。</p>
      <div class="quick-add-group">
        <input type="text" id="settings-new-cat" placeholder="输入新普通类别名称..." />
        <button type="button" class="btn-primary btn-sm" id="settings-add-cat-btn">新增类别</button>
      </div>
      <ul class="manage-list">
        ${normalCategories
          .map(
            (c) => `
          <li>
            <span>${escapeHtml(c.name)} ${c.active ? '' : '<em>（已停用）</em>'}</span>
            <div class="btn-row-inline">
              <button type="button" class="btn-secondary btn-sm btn-rename-cat" data-id="${escapeHtml(c.id)}">重命名</button>
              <button type="button" class="btn-danger-outline btn-sm btn-toggle-cat" data-id="${escapeHtml(c.id)}">
                ${c.active ? '删除/停用' : '重新启用'}
              </button>
            </div>
          </li>
        `
          )
          .join('')}
      </ul>
    </section>

    <section class="card settings-section">
      <h2>支付对象管理</h2>
      <p class="hint-text">“我、小狗、我&小狗”重命名后仍保留其专属 50% 分摊身份；已被引用的对象删除时改为停用。</p>
      <div class="quick-add-group">
        <input type="text" id="settings-new-payee" placeholder="输入新支付对象名称..." />
        <button type="button" class="btn-primary btn-sm" id="settings-add-payee-btn">新增支付对象</button>
      </div>
      <ul class="manage-list">
        ${allPayees
          .map(
            (p) => `
          <li>
            <span>${escapeHtml(p.name)} ${p.active ? '' : '<em>（已停用）</em>'}</span>
            <div class="btn-row-inline">
              <button type="button" class="btn-secondary btn-sm btn-rename-payee" data-id="${escapeHtml(p.id)}">重命名</button>
              <button type="button" class="btn-danger-outline btn-sm btn-toggle-payee" data-id="${escapeHtml(p.id)}">
                ${p.active ? '删除/停用' : '重新启用'}
              </button>
            </div>
          </li>
        `
          )
          .join('')}
      </ul>
    </section>
  `;
}

export function bindSettingsEvents(container, {
  state,
  monthlyFilters,
  onConnectDrive,
  onManualSync,
  onDisconnectDrive,
  onUpdateThresholds,
  onUpdateFixedRule,
  onAddCategory,
  onRenameCategory,
  onToggleCategory,
  onAddPayee,
  onRenamePayee,
  onTogglePayee,
  onNotify
}) {
  container.querySelector('#drive-connect-btn')?.addEventListener('click', onConnectDrive);
  container.querySelector('#settings-sync-btn')?.addEventListener('click', onManualSync);
  container.querySelector('#drive-disconnect-btn')?.addEventListener('click', onDisconnectDrive);

  container.querySelector('#export-xlsx-btn')?.addEventListener('click', () => {
    try {
      const res = exportFilteredExpensesToXlsx(state, monthlyFilters);
      onNotify?.(`已导出 ${res.count} 条记录至 ${res.filename}`);
    } catch (err) {
      onNotify?.(err.message || '导出失败', true);
    }
  });

  container.querySelector('#thresholds-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(e.target);
      const m = centsToDecimal(decimalToCents(parseNonNegativeNumber(fd.get('monthlyRegularHkd'), '月度阈值').str));
      const d = centsToDecimal(decimalToCents(parseNonNegativeNumber(fd.get('dailyRegularHkd'), '每日阈值').str));
      await onUpdateThresholds({ monthlyRegularHkd: m, dailyRegularHkd: d });
    } catch (err) {
      onNotify?.(err.message || '保存阈值失败', true);
    }
  });

  container.querySelectorAll('.fixed-rule-card').forEach((form) => {
    const dueTypeSelect = form.querySelector('.rule-due-type');
    const dueDayInput = form.querySelector('input[name="dueDay"]');
    dueTypeSelect?.addEventListener('change', () => {
      dueDayInput.disabled = dueTypeSelect.value === 'last_day';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const ruleKey = form.dataset.ruleKey;
        const rule = (state.fixedRules || []).find((r) => r.ruleKey === ruleKey);
        if (!rule) return;
        const fd = new FormData(form);
        const amountHkd = centsToDecimal(decimalToCents(parseNonNegativeNumber(fd.get('amountHkd'), '固定支出金额').str));
        const effectiveFrom = String(fd.get('effectiveFrom') || '').trim();
        const dueType = String(fd.get('dueType') || 'last_day');
        let dueDayRule = 'last_day_of_month';
        if (dueType === 'day') {
          const dNum = Number(fd.get('dueDay'));
          if (!Number.isInteger(dNum) || dNum < 1 || dNum > 31) {
            throw new Error('每月指定日必须为 1 到 31 之间的整数');
          }
          dueDayRule = `day_of_month:${dNum}`;
        }
        const endDateRaw = String(fd.get('endDate') || '').trim();
        const endDate = endDateRaw || null;

        const nextRule = updateFixedRuleWithVersion(rule, { amountHkd, dueDayRule, endDate }, effectiveFrom);
        await onUpdateFixedRule(nextRule);
      } catch (err) {
        onNotify?.(err.message || '更新固定规则失败', true);
      }
    });
  });

  container.querySelector('#settings-add-cat-btn')?.addEventListener('click', async () => {
    const input = container.querySelector('#settings-new-cat');
    const name = (input?.value || '').trim();
    if (name) await onAddCategory(name);
  });

  container.querySelectorAll('.btn-rename-cat').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cat = (state.categories || []).find((c) => c.id === btn.dataset.id);
      if (!cat) return;
      const nextName = window.prompt('请输入新的类别名称：', cat.name);
      if (nextName && nextName.trim() && nextName.trim() !== cat.name) {
        await onRenameCategory(cat.id, nextName.trim());
      }
    });
  });

  container.querySelectorAll('.btn-toggle-cat').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await onToggleCategory(btn.dataset.id);
    });
  });

  container.querySelector('#settings-add-payee-btn')?.addEventListener('click', async () => {
    const input = container.querySelector('#settings-new-payee');
    const name = (input?.value || '').trim();
    if (name) await onAddPayee(name);
  });

  container.querySelectorAll('.btn-rename-payee').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const p = (state.payees || []).find((x) => x.id === btn.dataset.id);
      if (!p) return;
      const nextName = window.prompt('请输入新的支付对象名称：', p.name);
      if (nextName && nextName.trim() && nextName.trim() !== p.name) {
        await onRenamePayee(p.id, nextName.trim());
      }
    });
  });

  container.querySelectorAll('.btn-toggle-payee').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await onTogglePayee(btn.dataset.id);
    });
  });
}