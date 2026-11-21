import { computeAnnualMonthlyBars, computeMonthlyCategorySummary } from '../domain/analytics.js';
import { escapeHtml } from './recordsView.js';

// 锁定 Chart.js 版本（不使用 latest）
export const LOCKED_CHART_JS_VERSION = '4.4.7';
export const LOCKED_CHART_JS_URL = `https://cdn.jsdelivr.net/npm/chart.js@${LOCKED_CHART_JS_VERSION}/dist/chart.umd.min.js`;

function normalizePayeeSelection(nextIds, prevIds, clickedId) {
  if (clickedId === 'TOTAL') {
    return ['TOTAL'];
  }
  const withoutTotal = (nextIds || []).filter((id) => id !== 'TOTAL');
  if (withoutTotal.length === 0) {
    return ['TOTAL'];
  }
  return withoutTotal;
}

export function renderChartsPage({ state, chartFilters }) {
  const activePayees = (state.payees || []).filter((p) => p.active);
  const allCategories = (state.categories || []).filter((c) => c.active);

  const monthlyPayees = chartFilters.monthlyPayees || ['TOTAL'];
  const annualPayees = chartFilters.annualPayees || ['TOTAL'];
  const annualCategories =
    chartFilters.annualCategories === null || chartFilters.annualCategories === undefined
      ? allCategories.map((c) => c.id)
      : chartFilters.annualCategories;

  const monthSummary = computeMonthlyCategorySummary(state, {
    month: chartFilters.month,
    selectedPayeeIds: monthlyPayees
  });

  const annualBars = computeAnnualMonthlyBars(state, {
    year: chartFilters.year,
    selectedCategoryIds: annualCategories,
    selectedPayeeIds: annualPayees
  });

  const renderPayeeCheckboxes = (prefix, selectedList) => {
    const isTotal = selectedList.includes('TOTAL');
    return `
      <div class="chip-group">
        <label class="chip-item">
          <input type="checkbox" class="${prefix}-payee" value="TOTAL" ${isTotal ? 'checked' : ''} />
          <span>Total</span>
        </label>
        ${activePayees
          .map(
            (p) => `
          <label class="chip-item">
            <input type="checkbox" class="${prefix}-payee" value="${escapeHtml(p.id)}" ${
              !isTotal && selectedList.includes(p.id) ? 'checked' : ''
            } />
            <span>${escapeHtml(p.name)}</span>
          </label>
        `
          )
          .join('')}
      </div>
    `;
  };

  let monthlyBodyHtml = '';
  if (monthSummary.isEmpty) {
    monthlyBodyHtml = `<div class="empty-tip">暂无支出（${escapeHtml(monthSummary.month)}）。</div>`;
  } else if (!monthSummary.canRenderPie) {
    monthlyBodyHtml = `
      <div class="fallback-notice">${escapeHtml(monthSummary.fallbackReason)}</div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>类别</th>
              <th>净额（HKD）</th>
            </tr>
          </thead>
          <tbody>
            ${monthSummary.items
              .map(
                (it) => `
              <tr>
                <td>${escapeHtml(it.categoryName)}</td>
                <td class="amount-text ${it.netCents < 0n ? 'amount-negative' : ''}">${escapeHtml(
                  it.netHkd
                )}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    monthlyBodyHtml = `
      <div class="monthly-chart-layout">
        <div class="chart-canvas-wrap">
          <canvas id="monthly-pie-canvas"></canvas>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>类别</th>
                <th>占比</th>
                <th>净额（HKD）</th>
              </tr>
            </thead>
            <tbody>
              ${monthSummary.items
                .map(
                  (it) => `
                <tr>
                  <td>${escapeHtml(it.categoryName)}</td>
                  <td class="amount-text">${escapeHtml(it.percentage)}</td>
                  <td class="amount-text">${escapeHtml(it.netHkd)}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  return `
    <section class="card chart-section" aria-label="月度分类汇总">
      <h2>月度分类汇总与饼图</h2>
      <div class="filter-grid">
        <label>
          <span>月份</span>
          <input type="month" id="chart-month" value="${escapeHtml(chartFilters.month)}" />
        </label>
        <div>
          <span class="field-label">支付对象（Total 与独立对象互斥）</span>
          ${renderPayeeCheckboxes('m-chart', monthlyPayees)}
        </div>
      </div>
      <div class="chart-result-box">
        ${monthlyBodyHtml}
      </div>
    </section>

    <section class="card chart-section" aria-label="年度收支柱状图">
      <h2>年度 12 个月合计柱状图</h2>
      <div class="filter-grid">
        <label>
          <span>年份（YYYY）</span>
          <input type="number" min="2000" max="2100" id="chart-year" value="${escapeHtml(chartFilters.year)}" />
        </label>
        <div>
          <span class="field-label">支付对象（默认 Total）</span>
          ${renderPayeeCheckboxes('a-chart', annualPayees)}
        </div>
        <div class="filter-span-2">
          <span class="field-label">类别多选（含每月固定支出，默认全选）</span>
          <div class="chip-group">
            ${allCategories
              .map(
                (c) => `
              <label class="chip-item">
                <input type="checkbox" class="a-chart-cat" value="${escapeHtml(c.id)}" ${
                  annualCategories.includes(c.id) ? 'checked' : ''
                } />
                <span>${escapeHtml(c.name)}</span>
              </label>
            `
              )
              .join('')}
          </div>
        </div>
      </div>
      <div class="chart-canvas-wrap chart-bar-wrap">
        <canvas id="annual-bar-canvas"></canvas>
      </div>
    </section>
  `;
}

export function mountChartsAndBindEvents(container, { state, chartFilters, onChartFiltersChange }) {
  const monthInput = container.querySelector('#chart-month');
  const yearInput = container.querySelector('#chart-year');

  monthInput?.addEventListener('change', () => {
    if (monthInput.value) {
      onChartFiltersChange({ ...chartFilters, month: monthInput.value });
    }
  });

  yearInput?.addEventListener('change', () => {
    const y = String(yearInput.value || '').trim();
    if (/^\d{4}$/.test(y)) {
      onChartFiltersChange({ ...chartFilters, year: y });
    }
  });

  const bindPayeeGroup = (selectorClass, keyName) => {
    container.querySelectorAll(`.${selectorClass}`).forEach((cb) => {
      cb.addEventListener('change', () => {
        const checked = Array.from(container.querySelectorAll(`.${selectorClass}:checked`)).map((el) => el.value);
        const nextList = normalizePayeeSelection(checked, chartFilters[keyName], cb.value);
        onChartFiltersChange({ ...chartFilters, [keyName]: nextList });
      });
    });
  };

  bindPayeeGroup('m-chart-payee', 'monthlyPayees');
  bindPayeeGroup('a-chart-payee', 'annualPayees');

  container.querySelectorAll('.a-chart-cat').forEach((cb) => {
    cb.addEventListener('change', () => {
      const checkedCats = Array.from(container.querySelectorAll('.a-chart-cat:checked')).map((el) => el.value);
      onChartFiltersChange({ ...chartFilters, annualCategories: checkedCats });
    });
  });

  if (typeof window.Chart === 'undefined') {
    return;
  }

  const palette = [
    '#6a994e',
    '#e57a9e',
    '#8ab17d',
    '#f28482',
    '#52b788',
    '#d97296',
    '#a7c957',
    '#e07a5f',
    '#74c69d',
    '#b56576'
  ];

  const monthSummary = computeMonthlyCategorySummary(state, {
    month: chartFilters.month,
    selectedPayeeIds: chartFilters.monthlyPayees || ['TOTAL']
  });

  const pieCanvas = container.querySelector('#monthly-pie-canvas');
  if (pieCanvas && monthSummary.canRenderPie) {
    new window.Chart(pieCanvas.getContext('2d'), {
      type: 'pie',
      data: {
        labels: monthSummary.items.map((it) => `${it.categoryName} (${it.percentage}) ${it.netHkd} HKD`),
        datasets: [
          {
            data: monthSummary.items.map((it) => Number(it.netHkd)),
            backgroundColor: monthSummary.items.map((_, idx) => palette[idx % palette.length])
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });
  }

  const allCategories = (state.categories || []).filter((c) => c.active);
  const annualCategories =
    chartFilters.annualCategories === null || chartFilters.annualCategories === undefined
      ? allCategories.map((c) => c.id)
      : chartFilters.annualCategories;

  const annualBars = computeAnnualMonthlyBars(state, {
    year: chartFilters.year,
    selectedCategoryIds: annualCategories,
    selectedPayeeIds: chartFilters.annualPayees || ['TOTAL']
  });

  const barCanvas = container.querySelector('#annual-bar-canvas');
  if (barCanvas) {
    new window.Chart(barCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: annualBars.map((b) => b.label),
        datasets: [
          {
            label: `${chartFilters.year}年合计净额 (HKD)`,
            data: annualBars.map((b) => b.netNumber),
            backgroundColor: annualBars.map((b) => (b.netNumber < 0 ? '#e57a9e' : '#6a994e'))
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }
}