import { escapeHtml, renderExpensesListHtml } from './recordsView.js';

export function renderRecordsPage({ state, filters }) {
  return `
    <section class="page-header-row">
      <div>
        <h2>月记录</h2>
        <p class="hint-text">按支出日期升序排列，同日按创建时间升序；金额下限按原始换算 HKD 判断。</p>
      </div>
    </section>
    ${renderExpensesListHtml(state.expenses, state, {
      showFilters: true,
      filters
    })}
  `;
}

export function bindRecordsPageEvents(container, {
  state,
  filters,
  onFiltersChange,
  onEditExpense,
  onDeleteExpense
}) {
  const monthEl = container.querySelector('#filter-month');
  const payeeEl = container.querySelector('#filter-payee');
  const catEl = container.querySelector('#filter-category');
  const minEl = container.querySelector('#filter-min-hkd');
  const kwEl = container.querySelector('#filter-keyword');

  const emitChange = () => {
    if (typeof onFiltersChange === 'function') {
      onFiltersChange({
        month: monthEl?.value || filters.month,
        payeeId: payeeEl?.value || 'ALL',
        categoryId: catEl?.value || 'ALL',
        minAmountHkd: minEl?.value ?? '',
        keyword: kwEl?.value ?? ''
      });
    }
  };

  monthEl?.addEventListener('change', emitChange);
  payeeEl?.addEventListener('change', emitChange);
  catEl?.addEventListener('change', emitChange);
  minEl?.addEventListener('input', emitChange);
  kwEl?.addEventListener('input', emitChange);

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
      if (!window.confirm(`确认删除支出“${escapeHtml(target.title)}”（${target.expenseDate}，${target.amountHkd} HKD）吗？`)) {
        return;
      }
      if (typeof onDeleteExpense === 'function') {
        await onDeleteExpense(target);
      }
    });
  });
}