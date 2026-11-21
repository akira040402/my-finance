// Titik masuk aplikasi: boot, kunci/buka, routing berbasis hash, navigasi, dan delegasi event.
import { openDB } from './database/db.js';
import { ensureInitialized, loadData, updateSettings } from './services/finance.js';
import { state, bus, refresh } from './state.js';
import { esc, icon, openModal, closeModal, toast, errorMessage } from './ui/dom.js';
import { showSetup, showUnlock, hideLockScreen } from './ui/lock-screen.js';

import dashboard from './views/dashboard.js';
import accounts from './views/accounts.js';
import history from './views/history.js';
import reports from './views/reports.js';
import logs from './views/logs.js';
import data from './views/data.js';
import settings from './views/settings.js';
import txViews from './views/transactions.js';

const VIEWS = [
  { path: /^\/$/, view: dashboard, nav: 'home', label: 'Beranda' },
  { path: /^\/atm$/, view: accounts, nav: 'wallet', label: 'ATM' },
  { path: /^\/atm\/([^/]+)$/, view: accounts, nav: 'wallet', label: 'ATM', detail: true },
  { path: /^\/riwayat$/, view: history, nav: 'history', label: 'Riwayat' },
  { path: /^\/laporan$/, view: reports, nav: 'chart', label: 'Laporan' },
  { path: /^\/log$/, view: logs, nav: 'list', label: 'Log aktivitas' },
  { path: /^\/data$/, view: data, nav: 'archive', label: 'Data & backup' },
  { path: /^\/pengaturan$/, view: settings, nav: 'settings', label: 'Pengaturan' },
];

// Gabungkan semua aksi dari setiap modul view.
const ACTIONS = {};
const FORMS = {};
const CHANGES = {};
for (const v of [...new Set(VIEWS.map((x) => x.view)), txViews]) {
  Object.assign(ACTIONS, v.actions || {});
  Object.assign(FORMS, v.forms || {});
  Object.assign(CHANGES, v.changes || {});
}
Object.assign(ACTIONS, {
  'modal-close': () => closeModal(),
  'go': (el) => {
    location.hash = el.dataset.to;
    closeSheets();
  },
  'lock-now': () => lockApp(),
  'menu-open': () => openMenu(),
  'quick-add': () => openQuickAdd(),
  'sidebar-toggle': () => document.getElementById('app').classList.toggle('nav-open'),
});

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs) };
}

export function hrefTo(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== 'all'));
  const s = qs.toString();
  return `#${path}${s ? `?${s}` : ''}`;
}

function currentRoute() {
  const { path, query } = parseHash();
  for (const r of VIEWS) {
    const m = path.match(r.path);
    if (m) return { route: r, args: m.slice(1), query, path };
  }
  return null;
}

function renderNav(activePath) {
  const items = [
    { to: '#/', label: 'Beranda', ic: 'home', path: '/' },
    { to: '#/atm', label: 'ATM', ic: 'wallet', path: '/atm' },
    { to: '#/riwayat', label: 'Riwayat', ic: 'history', path: '/riwayat' },
    { to: '#/laporan', label: 'Laporan', ic: 'chart', path: '/laporan' },
    { to: '#/log', label: 'Log aktivitas', ic: 'list', path: '/log' },
    { to: '#/data', label: 'Data & backup', ic: 'archive', path: '/data' },
    { to: '#/pengaturan', label: 'Pengaturan', ic: 'settings', path: '/pengaturan' },
  ];
  const isActive = (p) => (p === '/' ? activePath === '/' : activePath.startsWith(p));
  document.getElementById('side-nav').innerHTML = items
    .map((i) => `<a class="side-link ${isActive(i.path) ? 'active' : ''}" href="${i.to}">${icon(i.ic)}<span>${i.label}</span></a>`)
    .join('');
  const bottom = [
    { to: '#/', label: 'Beranda', ic: 'home', path: '/' },
    { to: '#/atm', label: 'ATM', ic: 'wallet', path: '/atm' },
    null,
    { to: '#/riwayat', label: 'Riwayat', ic: 'history', path: '/riwayat' },
    { to: '#/laporan', label: 'Laporan', ic: 'chart', path: '/laporan' },
  ];
  document.getElementById('bottom-nav').innerHTML = bottom
    .map((i) =>
      i === null
        ? `<button class="fab" data-action="quick-add" aria-label="Tambah transaksi">${icon('plus')}</button>`
        : `<a class="bnav-link ${isActive(i.path) ? 'active' : ''}" href="${i.to}">${icon(i.ic)}<span>${i.label}</span></a>`,
    )
    .join('');
}

function render() {
  if (!state.unlocked || !state.data) return;
  const found = currentRoute();
  if (!found) {
    location.hash = '#/';
    return;
  }
  const { route, args, query, path } = found;
  const ctx = { data: state.data, settings: state.settings, query, args, path };
  const main = document.getElementById('main');
  const title = typeof route.view.title === 'function' ? route.view.title(ctx) : route.label;
  const head = route.detail ? '' : `<div class="page-head"><h1>${esc(title)}</h1></div>`;
  try {
    main.innerHTML = `${head}${route.view.render(ctx)}`;
  } catch (err) {
    main.innerHTML = `<div class="card"><p class="field-error">Halaman gagal ditampilkan: ${esc(errorMessage(err))}</p></div>`;
  }
  route.view.after?.(main, ctx);
  document.title = `${title} · MY FINANCE`;
  renderNav(path);
  main.focus({ preventScroll: true });
}
bus.render = render;

function closeSheets() {
  closeModal();
}

function openQuickAdd() {
  openModal({
    title: 'Tambah',
    body: `<div class="quick-grid">
      <button class="quick in" data-action="tx-new" data-type="income">${icon('arrowDown')}<span>Pemasukan</span></button>
      <button class="quick out" data-action="tx-new" data-type="expense">${icon('arrowUp')}<span>Pengeluaran</span></button>
      <button class="quick move" data-action="transfer-new">${icon('transfer')}<span>Transfer</span></button>
    </div>
    <p class="hint">Transfer memindahkan saldo antar-ATM dan tidak dihitung sebagai pemasukan atau pengeluaran.</p>`,
  });
}

function openMenu() {
  const links = [
    ['#/laporan', 'Laporan', 'chart'],
    ['#/log', 'Log aktivitas', 'list'],
    ['#/data', 'Data & backup', 'archive'],
    ['#/pengaturan', 'Pengaturan', 'settings'],
  ];
  openModal({
    title: 'Menu',
    body: `<nav class="menu-list">${links
      .map(([to, label, ic]) => `<a class="menu-item" href="${to}" data-action="go" data-to="${to}">${icon(ic)}<span>${label}</span></a>`)
      .join('')}
      <button class="menu-item danger" data-action="lock-now">${icon('lock')}<span>Kunci aplikasi</span></button></nav>`,
  });
}

/* ---------- Kunci otomatis ---------- */

let idleTimer = null;
let hiddenAt = 0;

function resetIdle() {
  clearTimeout(idleTimer);
  const minutes = Number(state.settings?.autoLockMinutes) || 0;
  if (!state.unlocked || minutes <= 0) return;
  idleTimer = setTimeout(() => lockApp(), minutes * 60_000);
}

export function lockApp() {
  if (!state.unlocked) return;
  state.unlocked = false;
  state.data = null;
  clearTimeout(idleTimer);
  closeModal();
  document.getElementById('app').hidden = true;
  startLock();
}

function startLock() {
  showUnlock(state.settings, () => {
    hideLockScreen();
    state.unlocked = true;
    document.getElementById('app').hidden = false;
    unlockFlow();
  });
}

async function unlockFlow() {
  await refresh();
  resetIdle();
  render();
}

function bindActivity() {
  for (const ev of ['pointerdown', 'keydown', 'input']) {
    document.addEventListener(ev, () => resetIdle(), { passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else if (state.unlocked) {
      const minutes = Number(state.settings?.autoLockMinutes) || 0;
      if (minutes > 0 && hiddenAt && Date.now() - hiddenAt >= minutes * 60_000) lockApp();
      hiddenAt = 0;
    }
  });
}

/* ---------- Delegasi event ---------- */

function bindDelegation() {
  document.addEventListener('click', async (e) => {
    // Klik langsung pada latar modal menutupnya; klik di dalam kotak modal tidak.
    if (e.target.matches?.('[data-backdrop]')) {
      closeModal();
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (!fn) return;
    // Jangan cegah default tombol submit di dalam form.
    if (el.tagName !== 'A' && !(el.tagName === 'BUTTON' && el.type === 'submit')) e.preventDefault();
    try {
      await fn(el, e);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  });
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = FORMS[form.dataset.form];
    if (!fn) return;
    try {
      await fn(form, e);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const fn = CHANGES[el.dataset.change];
    if (!fn) return;
    try {
      await fn(el, e);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  });
  window.addEventListener('hashchange', () => {
    closeModal();
    if (state.unlocked) render();
  });
}

/* ---------- Service worker (PWA offline) ---------- */

function registerSW() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline cache tidak tersedia; aplikasi tetap berjalan dari jaringan */
    });
  }
}

/* ---------- Boot ---------- */

async function boot() {
  bindDelegation();
  bindActivity();
  registerSW();
  try {
    await openDB();
    state.settings = await ensureInitialized();
  } catch (err) {
    document.getElementById('lock-root').hidden = false;
    document.getElementById('lock-root').innerHTML = `<div class="lock-wrap"><div class="lock-card"><h1>MY FINANCE</h1><p class="field-error">${esc(errorMessage(err))}</p></div></div>`;
    return;
  }
  if (!state.settings.securitySettings?.pin) {
    showSetup(async () => {
      state.settings = await updateSettings({});
      hideLockScreen();
      state.unlocked = true;
      document.getElementById('app').hidden = false;
      state.data = await loadData();
      toast('PIN dibuat. Selamat datang di MY FINANCE.');
      resetIdle();
      render();
      location.hash = location.hash || '#/';
    });
  } else {
    startLock();
  }
}

boot();
