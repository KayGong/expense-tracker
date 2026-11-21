import { filterAndSortMonthlyExpenses } from '../domain/analytics.js';
import {
  centsToDecimal,
  convertToHkdString,
  decimalToCents,
  getExpenseNetCents,
  parseNonNegativeNumber,
  parsePositiveRate,
  SUPPORTED_CURRENCIES
} from '../domain/money.js';

export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatHkDisplayTime(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

function statusLabel(status) {
  if (status === 'reimbursed') return '已报销';
  if (status === 'applied') return '已申请';
  return '未报销';
}

/**
 * 渲染支出记录列表（可用于 Home 当月简表或月记录页）
 */
export function renderExpensesListHtml(expenses, state, { showFilters = false, filters = {} } = {}) {
  const catMap = new Map((state.categories || []).map((c) => [c.id, c]));
  const payeeMap = new Map((state.payees || []).map((p) => [p.id, p]));

  const filtered = showFilters
    ? filterAndSortMonthlyExpenses(expenses, filters)
    : (expenses || [])
        .filter((e) => !e.deleted && (e.expenseDate || '').slice(0, 7) === filters.month)
        .sort((a, b) => {
          if (a.expenseDate !== b.expenseDate) return a.expenseDate.localeCompare(b.expenseDate);
          return (a.createdAt || '').localeCompare(b.createdAt || '');
        });

  let filterBarHtml = '';
  if (showFilters) {
    const activeCategories = (state.categories || []).filter((c) => c.active);
    const activePayees = (state.payees || []).filter((p) => p.active);
    filterBarHtml = `
      <div class="filter-panel card">
        <div class="filter-grid">
          <label>
            <span>月份</span>
            <input type="month" id="filter-month" value="${escapeHtml(filters.month || '')}" />
          </label>
          <label>
            <span>支付对象</span>
            <select id="filter-payee">
              <option value="ALL" ${filters.payeeId === 'ALL' ? 'selected' : ''}>全部对象</option>
              ${activePayees
                .map(
                  (p) =>
                    `<option value="${escapeHtml(p.id)}" ${filters.payeeId === p.id ? 'selected' : ''}>${escapeHtml(
                      p.name
                    )}</option>`
                )
                .join('')}
            </select>
          </label>
          <label>
            <span>类别</span>
            <select id="filter-category">
              <option value="ALL" ${filters.categoryId === 'ALL' ? 'selected' : ''}>全部类别</option>
              ${activeCategories
                .map(
                  (c) =>
                    `<option value="${escapeHtml(c.id)}" ${filters.categoryId === c.id ? 'selected' : ''}>${escapeHtml(
                      c.name
                    )}</option>`
                )
                .join('')}
            </select>
          </label>
          <label>
            <span>原始换算 HKD 下限 (≥)</span>
            <input type="number" step="0.01" min="0" id="filter-min-hkd" placeholder="如 100" value="${escapeHtml(
              filters.minAmountHkd || ''
            )}" />
          </label>
          <label class="filter-span-2">
            <span>项目 / 备注搜索</span>
            <input type="search" id="filter-keyword" placeholder="输入关键词实时筛选..." value="${escapeHtml(
              filters.keyword || ''
            )}" />
          </label>
        </div>
        <div class="filter-meta">共 <strong class="amount-text">${filtered.length}</strong> 条记录</div>
      </div>
    `;
  }

  if (filtered.length === 0) {
    return `${filterBarHtml}<div class="empty-tip card">暂无符合条件的支出记录。</div>`;
  }

  const cardsHtml = filtered
    .map((exp) => {
      const catName = catMap.get(exp.categoryId)?.name || exp.categoryId;
      const payeeName = payeeMap.get(exp.payeeId)?.name || exp.payeeId;
      const isFixed = exp.recordType === 'fixed';
      const reimbStatus = isFixed ? 'unreimbursed' : exp.reimbursement?.status || 'unreimbursed';
      const reimbHkd =
        !isFixed && reimbStatus === 'reimbursed'
          ? centsToDecimal(decimalToCents(exp.reimbursement?.amountHkd || '0.00'))
          : '0.00';
      const netHkd = centsToDecimal(getExpenseNetCents(exp));
      const netCents = getExpenseNetCents(exp);

      const badges = [];
      if (isFixed) badges.push('<span class="badge badge-fixed">每月固定支出</span>');
      else if (exp.isIrregular) badges.push('<span class="badge badge-irregular">非常规</span>');
      else badges.push('<span class="badge badge-regular">常规</span>');
      if (!isFixed) {
        badges.push(`<span class="badge badge-reimb">${escapeHtml(statusLabel(reimbStatus))}</span>`);
      }

      return `
        <article class="record-card card" data-id="${escapeHtml(exp.id)}">
          <div class="record-top">
            <div>
              <span class="record-date amount-text">${escapeHtml(exp.expenseDate)}</span>
              <strong class="record-title">${escapeHtml(exp.title)}</strong>
              <span class="record-badges">${badges.join('')}</span>
            </div>
            <div class="record-main-hkd amount-text ${netCents < 0n ? 'amount-negative' : ''}">
              净额 ${escapeHtml(netHkd)} HKD
            </div>
          </div>
          <div class="record-details">
            <span>类别：${escapeHtml(catName)}</span>
            <span>对象：${escapeHtml(payeeName)}</span>
            <span>原币：${escapeHtml(exp.originalAmount)} ${escapeHtml(exp.currency)}</span>
            <span>换算 HKD：${escapeHtml(exp.amountHkd)}</span>
            ${!isFixed ? `<span>已报销：${escapeHtml(reimbHkd)} HKD</span>` : ''}
            <span>创建：${escapeHtml(formatHkDisplayTime(exp.createdAt))}</span>
            ${exp.note ? `<span class="record-note">备注：${escapeHtml(exp.note)}</span>` : ''}
          </div>
          <div class="record-actions">
            <button type="button" class="btn-secondary btn-sm btn-edit-exp" data-id="${escapeHtml(exp.id)}">编辑</button>
            <button type="button" class="btn-danger-outline btn-sm btn-del-exp" data-id="${escapeHtml(exp.id)}">删除</button>
          </div>
        </article>
      `;
    })
    .join('');

  return `${filterBarHtml}<div class="records-list">${cardsHtml}</div>`;
}

/**
 * 打开记录编辑模态框（保留 createdAt，更新 updatedAt，离开“已报销”归零报销金额）
 */
export function openEditExpenseModal(expense, state, onSave) {
  const existing = document.getElementById('edit-expense-modal');
  if (existing) existing.remove();

  const isFixed = expense.recordType === 'fixed';
  const normalCategories = (state.categories || []).filter((c) => c.kind === 'normal' && c.active);
  const activePayees = (state.payees || []).filter((p) => p.active);
  const currentReimbStatus = isFixed ? 'unreimbursed' : expense.reimbursement?.status || 'unreimbursed';
  const currentReimbAmount =
    !isFixed && currentReimbStatus === 'reimbursed' ? expense.reimbursement?.amountHkd || '0.00' : '0.00';

  const modal = document.createElement('div');
  modal.id = 'edit-expense-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-card card" role="dialog" aria-modal="true" aria-label="编辑支出">
      <h3>编辑支出${isFixed ? '（固定支出实例）' : ''}</h3>
      <form id="edit-expense-form">
        <label>
          <span>支出日期（香港日历）</span>
          <input type="date" name="expenseDate" value="${escapeHtml(expense.expenseDate)}" required />
        </label>
        <label>
          <span>项目名称</span>
          <input type="text" name="title" value="${escapeHtml(expense.title)}" required />
        </label>
        ${
          isFixed
            ? `<div class="hint-text">固定支出类别固定为“每月固定支出”，且不参与常规/非常规或预警。</div>`
            : `
          <label>
            <span>类别</span>
            <select name="categoryId">
              ${normalCategories
                .map(
                  (c) =>
                    `<option value="${escapeHtml(c.id)}" ${c.id === expense.categoryId ? 'selected' : ''}>${escapeHtml(
                      c.name
                    )}</option>`
                )
                .join('')}
            </select>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" name="isIrregular" ${expense.isIrregular ? 'checked' : ''} />
            <span>非常规支出</span>
          </label>
        `
        }
        <label>
          <span>支付对象</span>
          <select name="payeeId">
            ${activePayees
              .map(
                (p) =>
                  `<option value="${escapeHtml(p.id)}" ${p.id === expense.payeeId ? 'selected' : ''}>${escapeHtml(
                    p.name
                  )}</option>`
              )
              .join('')}
          </select>
        </label>
        <div class="form-row-2">
          <label>
            <span>币种</span>
            <select name="currency" id="edit-currency">
              ${SUPPORTED_CURRENCIES.map(
                (cur) => `<option value="${cur}" ${cur === expense.currency ? 'selected' : ''}>${cur}</option>`
              ).join('')}
            </select>
          </label>
          <label>
            <span>汇率（外币 = 1 HKD）</span>
            <input type="text" name="exchangeRate" id="edit-rate" value="${escapeHtml(expense.exchangeRate)}" required />
          </label>
        </div>
        <div class="form-row-2">
          <label>
            <span>原始金额</span>
            <input type="text" name="originalAmount" id="edit-orig-amt" value="${escapeHtml(
              expense.originalAmount
            )}" required />
          </label>
          <label>
            <span>自动换算 HKD</span>
            <input type="text" id="edit-hkd-preview" value="${escapeHtml(expense.amountHkd)}" readonly />
          </label>
        </div>
        ${
          !isFixed
            ? `
          <div class="form-row-2">
            <label>
              <span>报销状态</span>
              <select name="reimbStatus" id="edit-reimb-status">
                <option value="unreimbursed" ${currentReimbStatus === 'unreimbursed' ? 'selected' : ''}>未报销</option>
                <option value="applied" ${currentReimbStatus === 'applied' ? 'selected' : ''}>已申请</option>
                <option value="reimbursed" ${currentReimbStatus === 'reimbursed' ? 'selected' : ''}>已报销</option>
              </select>
            </label>
            <label>
              <span>已报销金额（HKD）</span>
              <input type="text" name="reimbAmountHkd" id="edit-reimb-amt" value="${escapeHtml(
                currentReimbAmount
              )}" ${currentReimbStatus !== 'reimbursed' ? 'disabled' : ''} />
            </label>
          </div>
          <div class="hint-text">说明：仅“已报销”状态计入扣减；切换离开“已报销”时，已报销金额将自动清零。</div>
        `
            : ''
        }
        <label>
          <span>备注</span>
          <input type="text" name="note" value="${escapeHtml(expense.note || '')}" />
        </label>
        <div id="edit-err" class="form-error"></div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="edit-cancel-btn">取消</button>
          <button type="submit" class="btn-primary">保存修改</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  const form = modal.querySelector('#edit-expense-form');
  const curSelect = modal.querySelector('#edit-currency');
  const rateInput = modal.querySelector('#edit-rate');
  const origInput = modal.querySelector('#edit-orig-amt');
  const hkdPreview = modal.querySelector('#edit-hkd-preview');
  const reimbSelect = modal.querySelector('#edit-reimb-status');
  const reimbInput = modal.querySelector('#edit-reimb-amt');
  const errBox = modal.querySelector('#edit-err');

  const refreshPreview = () => {
    try {
      const cur = curSelect.value;
      if (cur === 'HKD') {
        rateInput.value = '1';
        rateInput.readOnly = true;
      } else {
        rateInput.readOnly = false;
      }
      hkdPreview.value = convertToHkdString(origInput.value, cur, rateInput.value);
      errBox.textContent = '';
    } catch {
      hkdPreview.value = '-';
    }
  };

  curSelect.addEventListener('change', () => {
    if (curSelect.value === 'HKD') rateInput.value = '1';
    else if (curSelect.value === 'CNY' && (!rateInput.value || rateInput.value === '1')) rateInput.value = '0.85';
    refreshPreview();
  });
  rateInput.addEventListener('input', refreshPreview);
  origInput.addEventListener('input', refreshPreview);

  if (reimbSelect && reimbInput) {
    reimbSelect.addEventListener('change', () => {
      if (reimbSelect.value !== 'reimbursed') {
        reimbInput.value = '0.00';
        reimbInput.disabled = true;
      } else {
        reimbInput.disabled = false;
      }
    });
  }

  modal.querySelector('#edit-cancel-btn').addEventListener('click', () => modal.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(form);
      const expenseDate = String(fd.get('expenseDate') || '').trim();
      const title = String(fd.get('title') || '').trim();
      if (!expenseDate || !title) {
        throw new Error('请填写支出日期和项目名称');
      }
      const currency = String(fd.get('currency') || 'HKD');
      const { str: origAmtStr } = parseNonNegativeNumber(fd.get('originalAmount'), '原始金额');
      const rateStr = currency === 'HKD' ? '1' : parsePositiveRate(fd.get('exchangeRate')).str;
      const amountHkd = convertToHkdString(origAmtStr, currency, rateStr);

      let nextReimb = { status: 'unreimbursed', amountHkd: '0.00' };
      if (!isFixed) {
        const st = String(fd.get('reimbStatus') || 'unreimbursed');
        if (st === 'reimbursed') {
          const { str: rAmtStr } = parseNonNegativeNumber(fd.get('reimbAmountHkd') || '0', '报销金额');
          nextReimb = { status: 'reimbursed', amountHkd: centsToDecimal(decimalToCents(rAmtStr)) };
        } else {
          nextReimb = { status: st, amountHkd: '0.00' };
        }
      }

      const updatedExpense = {
        ...expense,
        expenseDate,
        title,
        categoryId: isFixed ? 'cat_fixed_monthly' : String(fd.get('categoryId') || expense.categoryId),
        payeeId: String(fd.get('payeeId') || expense.payeeId),
        currency,
        originalAmount: centsToDecimal(decimalToCents(origAmtStr)),
        exchangeRate: rateStr,
        amountHkd,
        isIrregular: isFixed ? false : Boolean(fd.get('isIrregular')),
        reimbursement: nextReimb,
        note: String(fd.get('note') || '').trim(),
        updatedAt: new Date().toISOString()
        // 明确保留 expense.createdAt 不变
      };

      await onSave(updatedExpense);
      modal.remove();
    } catch (err) {
      errBox.textContent = err.message || '保存失败';
    }
  });
}