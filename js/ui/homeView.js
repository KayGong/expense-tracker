import { computeHomeSummaryAndAlerts } from '../domain/analytics.js';
import { getHkDateString } from '../domain/hkTime.js';
import {
  centsToDecimal,
  convertToHkdString,
  decimalToCents,
  getDefaultExchangeRate,
  parseNonNegativeNumber,
  parsePositiveRate,
  SUPPORTED_CURRENCIES
} from '../domain/money.js';
import { escapeHtml, renderExpensesListHtml } from './recordsView.js';

export function formatSyncStatusLabel(syncUiState, hasDirtyLocalChanges) {
  if (syncUiState?.status === 'syncing') {
    return { text: '正在同步...', tone: 'syncing', canManualSync: false };
  }
  if (syncUiState?.status === 'error') {
    return {
      text: `同步失败：${syncUiState.errorMessage || '网络或云端异常'}（已保留本地待同步数据）`,
      tone: 'error',
      canManualSync: true
    };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      text: '离线，数据仅保存在本机（联网后可同步）',
      tone: 'offline',
      canManualSync: false
    };
  }
  if (!syncUiState?.connected) {
    return {
      text: hasDirtyLocalChanges
        ? '离线 / 数据仅保存在本机（有待同步变更，可在设定页连接 Google Drive）'
        : '数据仅保存在本机（尚未连接 Google Drive）',
      tone: 'local-only',
      canManualSync: false
    };
  }
  if (hasDirtyLocalChanges) {
    return {
      text: '尚未同步完成（存在未处理的本地变更）',
      tone: 'pending',
      canManualSync: true
    };
  }
  return {
    text: '已同步',
    tone: 'synced',
    canManualSync: true
  };
}

export function renderHomePage({
  state,
  hasDirtyLocalChanges,
  syncUiState,
  lastActionNotice = '',
  now = new Date()
}) {
  const { calendar, cards, alerts } = computeHomeSummaryAndAlerts(state, now);
  const normalCategories = (state.categories || []).filter((c) => c.kind === 'normal' && c.active);
  const activePayees = (state.payees || []).filter((p) => p.active);
  const defaultPayeeId = activePayees.some((p) => p.id === 'payee_me')
    ? 'payee_me'
    : activePayees[0]?.id || '';
  const defaultCategoryId = normalCategories.some((c) => c.id === 'cat_dining')
    ? 'cat_dining'
    : normalCategories[0]?.id || '';

  const syncInfo = formatSyncStatusLabel(syncUiState, hasDirtyLocalChanges);

  const alertsHtml =
    alerts.monthlyAlert || alerts.dailyAlert
      ? `
      <section class="alerts-section" aria-label="超支预警">
        ${
          alerts.monthlyAlert
            ? `<div class="alert-banner alert-monthly">${escapeHtml(alerts.monthlyAlert.message)}</div>`
            : ''
        }
        ${
          alerts.dailyAlert
            ? `<div class="alert-banner alert-daily">${escapeHtml(alerts.dailyAlert.message)}</div>`
            : ''
        }
      </section>
    `
      : '';

  const cardsData = [
    { label: '当日常规支出总和', value: cards.todayRegularHkd },
    { label: '当日非常规支出总和', value: cards.todayIrregularHkd },
    { label: '当月常规支出总和', value: cards.monthRegularHkd },
    { label: '当月非常规支出总和', value: cards.monthIrregularHkd },
    { label: '每月固定支出', value: cards.monthFixedHkd },
    { label: '当月总支出', value: cards.monthTotalHkd, highlight: true }
  ];

  const summaryCardsHtml = `
    <section class="summary-section" aria-label="支出汇总卡">
      <div class="section-header-row">
        <h2>支出汇总卡</h2>
        <span class="hk-date-pill">香港今日：${escapeHtml(calendar.today)}（${escapeHtml(
    calendar.currentMonth
  )}）</span>
      </div>
      <div class="summary-grid">
        ${cardsData
          .map((c) => {
            const isNeg = c.value.startsWith('-');
            return `
              <div class="summary-card card ${c.highlight ? 'summary-card-total' : ''}">
                <div class="summary-label">${escapeHtml(c.label)}</div>
                <div class="summary-value amount-text ${isNeg ? 'amount-negative' : ''}">
                  ${escapeHtml(c.value)} <span class="unit">HKD</span>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    </section>
  `;

  const addFormHtml = `
    <section class="form-section card" aria-label="新增支出表单">
      <h2>新增支出</h2>
      ${lastActionNotice ? `<div class="notice-banner">${escapeHtml(lastActionNotice)}</div>` : ''}
      <form id="add-expense-form">
        <div class="form-row-2">
          <label>
            <span>支出日期（默认香港今天）</span>
            <input type="date" name="expenseDate" id="add-date" value="${escapeHtml(
              getHkDateString(now)
            )}" required />
          </label>
          <label>
            <span>项目名称（必填）</span>
            <input type="text" name="title" id="add-title" placeholder="例如：午餐、地铁" required />
          </label>
        </div>

        <div class="form-row-2">
          <label>
            <span>类别</span>
            <select name="categoryId" id="add-category">
              ${normalCategories
                .map(
                  (c) =>
                    `<option value="${escapeHtml(c.id)}" ${
                      c.id === defaultCategoryId ? 'selected' : ''
                    }>${escapeHtml(c.name)}</option>`
                )
                .join('')}
            </select>
          </label>
          <label>
            <span>支付对象</span>
            <select name="payeeId" id="add-payee">
              ${activePayees
                .map(
                  (p) =>
                    `<option value="${escapeHtml(p.id)}" ${
                      p.id === defaultPayeeId ? 'selected' : ''
                    }>${escapeHtml(p.name)}</option>`
                )
                .join('')}
            </select>
          </label>
        </div>

        <div class="quick-add-row">
          <div class="quick-add-group">
            <input type="text" id="quick-cat-name" placeholder="快速新增普通类别..." />
            <button type="button" class="btn-secondary btn-sm" id="quick-cat-btn">添加类别</button>
          </div>
          <div class="quick-add-group">
            <input type="text" id="quick-payee-name" placeholder="快速新增支付对象..." />
            <button type="button" class="btn-secondary btn-sm" id="quick-payee-btn">添加对象</button>
          </div>
        </div>

        <div class="form-row-3">
          <label>
            <span>币种</span>
            <select name="currency" id="add-currency">
              ${SUPPORTED_CURRENCIES.map(
                (cur) => `<option value="${cur}" ${cur === 'HKD' ? 'selected' : ''}>${cur}</option>`
              ).join('')}
            </select>
          </label>
          <label>
            <span>原始金额</span>
            <input type="text" name="originalAmount" id="add-orig-amount" placeholder="0.00" required />
          </label>
          <label>
            <span>汇率（外币 = 1 HKD）</span>
            <input type="text" name="exchangeRate" id="add-rate" value="1" readonly required />
          </label>
        </div>

        <div class="form-row-2">
          <label>
            <span>换算 HKD 金额</span>
            <input type="text" id="add-hkd-preview" value="0.00" readonly />
          </label>
          <label class="checkbox-row checkbox-align">
            <input type="checkbox" name="isIrregular" id="add-irregular" />
            <span>非常规支出</span>
          </label>
        </div>

        <div class="form-row-2">
          <label>
            <span>报销状态</span>
            <select name="reimbStatus" id="add-reimb-status">
              <option value="unreimbursed" selected>未报销</option>
              <option value="applied">已申请</option>
              <option value="reimbursed">已报销</option>
            </select>
          </label>
          <label>
            <span>报销金额（HKD）</span>
            <input type="text" name="reimbAmountHkd" id="add-reimb-amount" value="0.00" disabled />
          </label>
        </div>
        <div class="hint-text">提示：仅“已报销”状态会扣减统计净额；离开“已报销”时将自动清零报销金额。</div>

        <label>
          <span>备注</span>
          <input type="text" name="note" id="add-note" placeholder="可选备注" />
        </label>

        <div id="add-form-error" class="form-error"></div>
        <button type="submit" class="btn-primary btn-full">新增支出</button>
      </form>
    </section>
  `;

  const syncBoxHtml = `
    <section class="sync-section card sync-${escapeHtml(syncInfo.tone)}" aria-label="同步状态">
      <div class="sync-row">
        <div>
          <strong>同步状态：</strong>
          <span>${escapeHtml(syncInfo.text)}</span>
        </div>
        ${
          syncInfo.canManualSync
            ? '<button type="button" class="btn-secondary btn-sm" id="manual-sync-btn">手动同步</button>'
            : ''
        }
      </div>
    </section>
  `;

  const monthBriefHtml = `
    <section class="brief-section" aria-label="当月全部支出简表">
      <div class="section-header-row">
        <h2>当月支出简表（${escapeHtml(calendar.currentMonth)}）</h2>
      </div>
      ${renderExpensesListHtml(state.expenses, state, {
        showFilters: false,
        filters: { month: calendar.currentMonth }
      })}
    </section>
  `;

  return `${alertsHtml}${summaryCardsHtml}${addFormHtml}${syncBoxHtml}${monthBriefHtml}`;
}

export function bindHomeEvents(container, {
  state,
  onCreateExpense,
  onQuickAddCategory,
  onQuickAddPayee,
  onManualSync,
  onEditExpense,
  onDeleteExpense
}) {
  const form = container.querySelector('#add-expense-form');
  if (!form) return;

  const curSelect = form.querySelector('#add-currency');
  const rateInput = form.querySelector('#add-rate');
  const origInput = form.querySelector('#add-orig-amount');
  const hkdPreview = form.querySelector('#add-hkd-preview');
  const reimbSelect = form.querySelector('#add-reimb-status');
  const reimbInput = form.querySelector('#add-reimb-amount');
  const errEl = form.querySelector('#add-form-error');

  const updateHkdPreview = () => {
    try {
      if (!origInput.value.trim()) {
        hkdPreview.value = '0.00';
        errEl.textContent = '';
        return;
      }
      hkdPreview.value = convertToHkdString(origInput.value, curSelect.value, rateInput.value);
      errEl.textContent = '';
    } catch {
      hkdPreview.value = '-';
    }
  };

  curSelect.addEventListener('change', () => {
    const cur = curSelect.value;
    rateInput.value = getDefaultExchangeRate(cur);
    rateInput.readOnly = cur === 'HKD';
    updateHkdPreview();
  });

  origInput.addEventListener('input', updateHkdPreview);
  rateInput.addEventListener('input', updateHkdPreview);

  reimbSelect.addEventListener('change', () => {
    if (reimbSelect.value !== 'reimbursed') {
      reimbInput.value = '0.00';
      reimbInput.disabled = true;
    } else {
      reimbInput.disabled = false;
    }
  });

  container.querySelector('#quick-cat-btn')?.addEventListener('click', async () => {
    const input = container.querySelector('#quick-cat-name');
    const name = (input?.value || '').trim();
    if (!name) return;
    await onQuickAddCategory(name);
  });

  container.querySelector('#quick-payee-btn')?.addEventListener('click', async () => {
    const input = container.querySelector('#quick-payee-name');
    const name = (input?.value || '').trim();
    if (!name) return;
    await onQuickAddPayee(name);
  });

  container.querySelector('#manual-sync-btn')?.addEventListener('click', async () => {
    if (typeof onManualSync === 'function') {
      await onManualSync();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    try {
      const fd = new FormData(form);
      const expenseDate = String(fd.get('expenseDate') || '').trim();
      const title = String(fd.get('title') || '').trim();
      if (!expenseDate) throw new Error('请选择支出日期');
      if (!title) throw new Error('请填写项目名称');

      const currency = String(fd.get('currency') || 'HKD');
      const { str: origStr } = parseNonNegativeNumber(fd.get('originalAmount'), '原始金额');
      const rateStr = currency === 'HKD' ? '1' : parsePositiveRate(fd.get('exchangeRate')).str;
      const amountHkd = convertToHkdString(origStr, currency, rateStr);

      const reimbStatus = String(fd.get('reimbStatus') || 'unreimbursed');
      let reimbAmountHkd = '0.00';
      if (reimbStatus === 'reimbursed') {
        const { str: rStr } = parseNonNegativeNumber(fd.get('reimbAmountHkd') || '0', '报销金额');
        reimbAmountHkd = centsToDecimal(decimalToCents(rStr));
      }

      const nowIso = new Date().toISOString();
      const newExpense = {
        id: `exp_${crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2, 8)}`,
        expenseDate,
        title,
        categoryId: String(fd.get('categoryId') || ''),
        payeeId: String(fd.get('payeeId') || ''),
        currency,
        originalAmount: centsToDecimal(decimalToCents(origStr)),
        exchangeRate: rateStr,
        amountHkd,
        isIrregular: Boolean(fd.get('isIrregular')),
        reimbursement: {
          status: reimbStatus,
          amountHkd: reimbAmountHkd
        },
        note: String(fd.get('note') || '').trim(),
        createdAt: nowIso,
        updatedAt: nowIso,
        recordType: 'normal',
        fixedRuleKey: null,
        fixedInstanceKey: null,
        billingMonth: null,
        deleted: false,
        deletedAt: null
      };

      await onCreateExpense(newExpense);
    } catch (err) {
      errEl.textContent = err.message || '新增失败';
    }
  });

  container.querySelectorAll('.btn-edit-exp').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = (state.expenses || []).find((x) => x.id === btn.dataset.id);
      if (target && typeof onEditExpense === 'function') {
        onEditExpense(target);
      }
    });
  });

  container.querySelectorAll('.btn-del-exp').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = (state.expenses || []).find((x) => x.id === btn.dataset.id);
      if (!target) return;
      if (!window.confirm(`确认删除支出“${target.title}”（${target.expenseDate}，${target.amountHkd} HKD）吗？`)) {
        return;
      }
      if (typeof onDeleteExpense === 'function') {
        await onDeleteExpense(target);
      }
    });
  });
}