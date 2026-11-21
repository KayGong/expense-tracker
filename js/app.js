import { APP_CONFIG } from './config.js';
import { backfillFixedExpenses } from './domain/fixedEngine.js';
import { getHkYearMonth } from './domain/hkTime.js';
import { LocalStore, normalizeAccountScope } from './storage/localStore.js';
import { GoogleDriveSyncClient } from './storage/driveClient.js';
import { mountPinLockOverlay } from './ui/pinLock.js';
import { bindHomeEvents, renderHomePage } from './ui/homeView.js';
import { bindRecordsPageEvents, renderRecordsPage } from './ui/recordsPage.js';
import { openEditExpenseModal } from './ui/recordsView.js';
import {
  bindSettingsEvents,
  LOCKED_XLSX_URL,
  renderSettingsPage
} from './ui/settingsView.js';
import {
  LOCKED_CHART_JS_URL,
  mountChartsAndBindEvents,
  renderChartsPage
} from './ui/chartsView.js';

function loadScriptOnce(url) {
  return new Promise((resolve, reject) => {
    if (!url) return resolve();
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`加载脚本失败: ${url}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`加载脚本失败: ${url}`));
    document.head.appendChild(script);
  });
}

function registerServiceWorkerSafe() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service Worker 注册提示:', err);
      });
    });
  }
}

class ExpenseTrackerApp {
  constructor() {
    this.store = new LocalStore();
    this.drive = new GoogleDriveSyncClient(APP_CONFIG.googleDrive || {});
    this.state = null;
    this.hasDirtyLocalChanges = false;
    this.syncUiState = {
      status: 'idle', // 'idle' | 'syncing' | 'error'
      errorMessage: '',
      connected: false,
      userEmail: null
    };
    this.activeRoute = this.getRouteFromHash();
    this.lastActionNotice = '';

    const currentMonth = getHkYearMonth(new Date());
    this.monthlyFilters = {
      month: currentMonth,
      payeeId: 'ALL',
      categoryId: 'ALL',
      minAmountHkd: '',
      keyword: ''
    };
    this.chartFilters = {
      month: currentMonth,
      year: currentMonth.slice(0, 4),
      monthlyPayees: ['TOTAL'],
      annualPayees: ['TOTAL'],
      annualCategories: null
    };
  }

  getRouteFromHash() {
    const h = (window.location.hash || '#home').replace(/^#/, '');
    if (['home', 'records', 'charts', 'settings'].includes(h)) return h;
    return 'home';
  }

  async boot() {
    registerServiceWorkerSafe();
    const initialScope = await this.store.init();
    const loaded = await this.store.loadState(initialScope, new Date());

    if (loaded.corruptedReason) {
      this.state = null;
      this.hasDirtyLocalChanges = loaded.hasDirtyLocalChanges;
      this.syncUiState = {
        ...this.syncUiState,
        status: 'error',
        errorMessage: `本地账本缓存损坏（${loaded.corruptedReason}），请勿盲目覆盖云端，可切换账号或检查备份。`
      };
    } else {
      const backfilled = backfillFixedExpenses(loaded.state, new Date());
      this.state = backfilled.state;
      this.hasDirtyLocalChanges = loaded.hasDirtyLocalChanges || backfilled.generatedCount > 0;
      await this.store.saveState(this.state, {
        scope: initialScope,
        hasDirtyLocalChanges: this.hasDirtyLocalChanges
      });
    }

    window.addEventListener('hashchange', () => {
      this.activeRoute = this.getRouteFromHash();
      this.render();
    });

    window.addEventListener('online', () => {
      if (this.drive.isConnected() && this.hasDirtyLocalChanges) {
        this.performSync(false);
      } else {
        this.render();
      }
    });

    window.addEventListener('offline', () => {
      this.render();
    });

    // 每次打开或刷新均需验证 4 位 PIN
    mountPinLockOverlay({
      expectedSha256Hex: APP_CONFIG.passwordSha256,
      onUnlock: () => {
        this.render();
        if (this.drive.isConnected() && this.hasDirtyLocalChanges && navigator.onLine) {
          this.performSync(false);
        }
      }
    });
  }

  async commitLocalState(nextState, { autoSync = true, notice = '' } = {}) {
    const scope = normalizeAccountScope(this.drive.userEmail || this.store.activeScope);
    const now = new Date();
    const backfilled = backfillFixedExpenses(nextState, now);
    this.state = backfilled.state;
    this.hasDirtyLocalChanges = true;
    if (notice) {
      this.lastActionNotice = notice;
    }

    await this.store.saveState(this.state, {
      scope,
      hasDirtyLocalChanges: true
    });
    this.render();

    if (autoSync && this.drive.isConnected() && navigator.onLine) {
      await this.performSync(false);
    }
  }

  async performSync(showAlertOnError = true) {
    if (!this.state) return;
    if (!this.drive.isConnected()) {
      this.syncUiState = {
        ...this.syncUiState,
        status: 'error',
        errorMessage: '尚未连接 Google Drive 或授权已过期'
      };
      this.render();
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.render();
      return;
    }

    this.syncUiState = {
      ...this.syncUiState,
      status: 'syncing',
      errorMessage: ''
    };
    this.render();

    try {
      const scope = normalizeAccountScope(this.drive.userEmail || this.store.activeScope);
      const result = await this.drive.syncState(this.state);
      const backfilled = backfillFixedExpenses(result.mergedState, new Date());
      const hasNewFixed = backfilled.generatedCount > 0;
      this.state = backfilled.state;
      this.hasDirtyLocalChanges = hasNewFixed;

      await this.store.saveState(this.state, {
        scope,
        hasDirtyLocalChanges: hasNewFixed
      });
      if (!hasNewFixed) {
        await this.store.markSynced(scope, result.remoteRevision);
      }

      this.syncUiState = {
        status: 'idle',
        errorMessage: '',
        connected: true,
        userEmail: this.drive.userEmail
      };
      this.render();

      if (hasNewFixed) {
        await this.performSync(false);
      }
    } catch (err) {
      const msg = err?.message || '同步失败';
      this.syncUiState = {
        ...this.syncUiState,
        status: 'error',
        errorMessage: msg
      };
      this.render();
      if (showAlertOnError) {
        window.alert(msg);
      }
    }
  }

  async handleConnectDrive() {
    try {
      const conn = await this.drive.connect({ prompt: 'consent' });
      const nextScope = await this.store.setActiveScope(conn.userEmail);
      const loaded = await this.store.loadState(nextScope, new Date());
      if (!loaded.corruptedReason) {
        this.state = loaded.state;
        this.hasDirtyLocalChanges = loaded.hasDirtyLocalChanges;
      }
      this.syncUiState = {
        status: 'idle',
        errorMessage: '',
        connected: true,
        userEmail: conn.userEmail
      };
      this.render();
      await this.performSync(true);
    } catch (err) {
      this.syncUiState = {
        ...this.syncUiState,
        status: 'error',
        errorMessage: err?.message || 'Google Drive 连接失败'
      };
      this.render();
      window.alert(this.syncUiState.errorMessage);
    }
  }

  async handleDisconnectDrive() {
    this.drive.disconnect();
    this.syncUiState = {
      status: 'idle',
      errorMessage: '',
      connected: false,
      userEmail: null
    };
    this.render();
  }

  async handleDeleteExpense(expense) {
    const nowIso = new Date().toISOString();
    const nextTombstones = {
      expenses: {
        ...(this.state.tombstones?.expenses || {}),
        [expense.id]: { deletedAt: nowIso }
      },
      fixedInstances: {
        ...(this.state.tombstones?.fixedInstances || {}),
        ...(expense.fixedInstanceKey ? { [expense.fixedInstanceKey]: { deletedAt: nowIso } } : {})
      }
    };

    const nextExpenses = (this.state.expenses || []).map((item) =>
      item.id === expense.id
        ? { ...item, deleted: true, deletedAt: nowIso, updatedAt: nowIso }
        : item
    );

    await this.commitLocalState(
      {
        ...this.state,
        expenses: nextExpenses,
        tombstones: nextTombstones
      },
      { notice: `已删除记录“${expense.title}”（本地已保存）。` }
    );
  }

  async handleEditExpenseSave(updatedExpense) {
    const nextExpenses = (this.state.expenses || []).map((item) =>
      item.id === updatedExpense.id ? updatedExpense : item
    );
    await this.commitLocalState(
      {
        ...this.state,
        expenses: nextExpenses
      },
      { notice: `已更新记录“${updatedExpense.title}”（本地已保存）。` }
    );
  }

  async render() {
    const navLinks = document.querySelectorAll('.top-nav a[data-route]');
    navLinks.forEach((a) => {
      a.classList.toggle('active', a.dataset.route === this.activeRoute);
    });

    const appEl = document.getElementById('app');
    if (!appEl) return;

    if (!this.state) {
      appEl.innerHTML = `
        <section class="card">
          <h2>数据状态提示</h2>
          <p class="form-error">${this.syncUiState.errorMessage || '无法读取账本数据'}</p>
        </section>
      `;
      return;
    }

    const now = new Date();

    if (this.activeRoute === 'home') {
      appEl.innerHTML = renderHomePage({
        state: this.state,
        hasDirtyLocalChanges: this.hasDirtyLocalChanges,
        syncUiState: this.syncUiState,
        lastActionNotice: this.lastActionNotice,
        now
      });
      this.lastActionNotice = '';

      bindHomeEvents(appEl, {
        state: this.state,
        onCreateExpense: async (newExp) => {
          await this.commitLocalState(
            {
              ...this.state,
              expenses: [...(this.state.expenses || []), newExp]
            },
            {
              notice: `已新增“${newExp.title}”（${newExp.amountHkd} HKD），本地已保存。`
            }
          );
        },
        onQuickAddCategory: async (name) => {
          const nowIso = new Date().toISOString();
          const newCat = {
            id: `cat_custom_${Date.now()}`,
            name,
            kind: 'normal',
            active: true,
            sortOrder: (this.state.categories || []).length + 1,
            updatedAt: nowIso
          };
          await this.commitLocalState(
            {
              ...this.state,
              categories: [...(this.state.categories || []), newCat]
            },
            { notice: `已新增类别“${name}”。` }
          );
        },
        onQuickAddPayee: async (name) => {
          const nowIso = new Date().toISOString();
          const newPayee = {
            id: `payee_custom_${Date.now()}`,
            name,
            splitRole: 'other',
            active: true,
            sortOrder: (this.state.payees || []).length + 1,
            updatedAt: nowIso
          };
          await this.commitLocalState(
            {
              ...this.state,
              payees: [...(this.state.payees || []), newPayee]
            },
            { notice: `已新增支付对象“${name}”。` }
          );
        },
        onManualSync: () => this.performSync(true),
        onEditExpense: (exp) => openEditExpenseModal(exp, this.state, (u) => this.handleEditExpenseSave(u)),
        onDeleteExpense: (exp) => this.handleDeleteExpense(exp)
      });
      return;
    }

    if (this.activeRoute === 'records') {
      appEl.innerHTML = renderRecordsPage({
        state: this.state,
        filters: this.monthlyFilters
      });
      bindRecordsPageEvents(appEl, {
        state: this.state,
        filters: this.monthlyFilters,
        onFiltersChange: (nextFilters) => {
          this.monthlyFilters = nextFilters;
          this.render();
        },
        onEditExpense: (exp) => openEditExpenseModal(exp, this.state, (u) => this.handleEditExpenseSave(u)),
        onDeleteExpense: (exp) => this.handleDeleteExpense(exp)
      });
      return;
    }

    if (this.activeRoute === 'charts') {
      try {
        await loadScriptOnce(LOCKED_CHART_JS_URL);
      } catch (err) {
        console.warn(err);
      }
      appEl.innerHTML = renderChartsPage({
        state: this.state,
        chartFilters: this.chartFilters
      });
      mountChartsAndBindEvents(appEl, {
        state: this.state,
        chartFilters: this.chartFilters,
        onChartFiltersChange: (nextChartFilters) => {
          this.chartFilters = nextChartFilters;
          this.render();
        }
      });
      return;
    }

    if (this.activeRoute === 'settings') {
      try {
        await loadScriptOnce(LOCKED_XLSX_URL);
      } catch (err) {
        console.warn(err);
      }
      appEl.innerHTML = renderSettingsPage({
        state: this.state,
        hasDirtyLocalChanges: this.hasDirtyLocalChanges,
        syncUiState: this.syncUiState,
        monthlyFilters: this.monthlyFilters,
        now
      });
      bindSettingsEvents(appEl, {
        state: this.state,
        monthlyFilters: this.monthlyFilters,
        onConnectDrive: () => this.handleConnectDrive(),
        onManualSync: () => this.performSync(true),
        onDisconnectDrive: () => this.handleDisconnectDrive(),
        onUpdateThresholds: async (thresholds) => {
          const nowIso = new Date().toISOString();
          await this.commitLocalState(
            {
              ...this.state,
              appSettings: {
                ...this.state.appSettings,
                alertThresholds: thresholds,
                updatedAt: nowIso,
                updatedByDeviceId: this.store.deviceId || 'local-device'
              }
            },
            { notice: '已更新超支预警阈值。' }
          );
        },
        onUpdateFixedRule: async (updatedRule) => {
          const nextRules = (this.state.fixedRules || []).map((r) =>
            r.ruleKey === updatedRule.ruleKey ? updatedRule : r
          );
          await this.commitLocalState(
            {
              ...this.state,
              fixedRules: nextRules
            },
            { notice: `已保存固定支出“${updatedRule.defaultTitle}”新版本（仅对后续到期实例生效）。` }
          );
        },
        onAddCategory: async (name) => {
          const nowIso = new Date().toISOString();
          const newCat = {
            id: `cat_custom_${Date.now()}`,
            name,
            kind: 'normal',
            active: true,
            sortOrder: (this.state.categories || []).length + 1,
            updatedAt: nowIso
          };
          await this.commitLocalState({
            ...this.state,
            categories: [...(this.state.categories || []), newCat]
          });
        },
        onRenameCategory: async (catId, name) => {
          const nowIso = new Date().toISOString();
          const nextCats = (this.state.categories || []).map((c) =>
            c.id === catId && c.kind !== 'system_fixed' ? { ...c, name, updatedAt: nowIso } : c
          );
          await this.commitLocalState({ ...this.state, categories: nextCats });
        },
        onToggleCategory: async (catId) => {
          const nowIso = new Date().toISOString();
          const isReferenced = (this.state.expenses || []).some((e) => e.categoryId === catId);
          const nextCats = (this.state.categories || []).map((c) => {
            if (c.id !== catId || c.kind === 'system_fixed') return c;
            if (c.active && isReferenced) {
              return { ...c, active: false, updatedAt: nowIso };
            }
            return { ...c, active: !c.active, updatedAt: nowIso };
          });
          await this.commitLocalState({ ...this.state, categories: nextCats });
        },
        onAddPayee: async (name) => {
          const nowIso = new Date().toISOString();
          const newPayee = {
            id: `payee_custom_${Date.now()}`,
            name,
            splitRole: 'other',
            active: true,
            sortOrder: (this.state.payees || []).length + 1,
            updatedAt: nowIso
          };
          await this.commitLocalState({
            ...this.state,
            payees: [...(this.state.payees || []), newPayee]
          });
        },
        onRenamePayee: async (payeeId, name) => {
          const nowIso = new Date().toISOString();
          const nextPayees = (this.state.payees || []).map((p) =>
            p.id === payeeId ? { ...p, name, updatedAt: nowIso } : p
          );
          await this.commitLocalState({ ...this.state, payees: nextPayees });
        },
        onTogglePayee: async (payeeId) => {
          const nowIso = new Date().toISOString();
          const isReferenced = (this.state.expenses || []).some((e) => e.payeeId === payeeId);
          const nextPayees = (this.state.payees || []).map((p) => {
            if (p.id !== payeeId) return p;
            if (p.active && isReferenced) {
              return { ...p, active: false, updatedAt: nowIso };
            }
            return { ...p, active: !p.active, updatedAt: nowIso };
          });
          await this.commitLocalState({ ...this.state, payees: nextPayees });
        },
        onNotify: (msg, isError = false) => {
          if (isError) window.alert(msg);
          else {
            this.lastActionNotice = msg;
            this.render();
          }
        }
      });
    }
  }
}

const app = new ExpenseTrackerApp();
app.boot();