// Log aktivitas: setiap perubahan data dicatat (data lama & baru). Log tidak pernah dihapus oleh edit.
import { state } from '../state.js';
import { formatRupiah, formatDateLong } from '../core/money.js';
import { esc, optionList, icon } from '../ui/dom.js';
import { actionLabel } from './transactions.js';

const ENTITY = {
  transaction: 'Transaksi', transfer: 'Transfer', account: 'ATM', category: 'Kategori', import: 'Impor CSV', backup: 'Backup/restore',
};
const FIELD_LABEL = {
  amount: 'Nominal', date: 'Tanggal', time: 'Jam', accountId: 'ATM', categoryId: 'Kategori', description: 'Keterangan',
  source: 'Sumber', purpose: 'Keperluan', type: 'Jenis', name: 'Nama', initialBalance: 'Saldo awal', note: 'Catatan',
  fromAccountId: 'ATM asal', toAccountId: 'ATM tujuan', fee: 'Biaya admin', includeInTotal: 'Ikut total', archivedAt: 'Arsip',
  deletedAt: 'Status hapus', createdAt: 'Dibuat', updatedAt: 'Diubah',
};
const SKIP = new Set(['id', 'createdAt', 'updatedAt']);

function fmtValue(key, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'amount' || key === 'initialBalance' || key === 'fee') return formatRupiah(v);
  if (key === 'accountId' || key === 'fromAccountId' || key === 'toAccountId') {
    return state.data?.accounts.find((a) => a.id === v)?.name || 'ATM dihapus';
  }
  if (key === 'categoryId') return state.data?.categories.find((c) => c.id === v)?.name || '—';
  if (key === 'archivedAt' || key === 'deletedAt') return v ? 'Ya' : 'Tidak';
  if (key === 'includeInTotal') return v ? 'Ya' : 'Tidak';
  if (key === 'type') return v === 'income' ? 'Pemasukan' : v === 'expense' ? 'Pengeluaran' : String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function diffHTML(oldData, newData) {
  if (!oldData || !newData) return '';
  const keys = [...new Set([...Object.keys(oldData), ...Object.keys(newData)])].filter((k) => !SKIP.has(k));
  const changed = keys.filter((k) => JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]));
  if (!changed.length) return '<p class="muted small">Tidak ada perubahan nilai.</p>';
  return `<table class="diff"><thead><tr><th>Data</th><th>Sebelum</th><th>Sesudah</th></tr></thead><tbody>
    ${changed.map((k) => `<tr><td>${esc(FIELD_LABEL[k] || k)}</td><td class="old">${esc(fmtValue(k, oldData[k]))}</td><td class="new">${esc(fmtValue(k, newData[k]))}</td></tr>`).join('')}
  </tbody></table>`;
}

function summaryOf(l) {
  const d = l.newData || l.oldData || {};
  if (l.entityType === 'transaction') return `${d.type === 'income' ? 'Pemasukan' : 'Pengeluaran'} ${formatRupiah(d.amount)}${d.description ? ` — ${d.description}` : ''}`;
  if (l.entityType === 'transfer') return `Transfer ${formatRupiah(d.amount)}${d.fee ? ` (biaya ${formatRupiah(d.fee)})` : ''}`;
  if (l.entityType === 'account') return `ATM ${d.name || ''}`;
  if (l.entityType === 'category') return `Kategori ${d.name || ''}`;
  if (l.entityType === 'import') return `${d.transactions ?? 0} transaksi diimpor${d.categoriesCreated ? `, ${d.categoriesCreated} kategori baru` : ''}`;
  if (l.entityType === 'backup') return l.action === 'restore' ? `Dipulihkan: ${d.counts?.transactions ?? 0} transaksi` : `Backup: ${d.counts?.transactions ?? 0} transaksi${d.encrypted ? ' (terenkripsi)' : ''}`;
  return '';
}

function render({ data, query }) {
  const type = query.get('jenis') || 'all';
  const action = query.get('aksi') || 'all';
  const logs = [...(data.activity_logs || [])]
    .filter((l) => (type === 'all' || l.entityType === type) && (action === 'all' || l.action === action))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const shown = logs.slice(0, 300);
  const typeOpts = [{ value: 'all', label: 'Semua jenis' }, ...Object.entries(ENTITY).map(([value, label]) => ({ value, label }))];
  const actionOpts = [{ value: 'all', label: 'Semua aksi' }, ...['create', 'update', 'delete', 'archive', 'unarchive', 'import', 'backup', 'restore'].map((v) => ({ value: v, label: actionLabel(v) }))];

  return `
    <section class="card">
      <form class="filters" data-form="log-noop">
        <label class="field"><span>Jenis data</span><select data-change="log-filter" data-key="jenis">${optionList(typeOpts, type)}</select></label>
        <label class="field"><span>Aksi</span><select data-change="log-filter" data-key="aksi">${optionList(actionOpts, action)}</select></label>
      </form>
      <p class="muted">${logs.length} catatan${logs.length > 300 ? ' (300 terbaru ditampilkan)' : ''}. Log tidak ikut hilang ketika data diedit.</p>
    </section>
    ${shown.length
      ? `<section class="log-feed">${shown.map((l) => `
          <article class="card log-item">
            <header class="log-head">
              <span class="badge badge-${l.action === 'delete' ? 'expense' : l.action === 'create' ? 'income' : 'transfer'}">${esc(actionLabel(l.action))}</span>
              <strong>${esc(ENTITY[l.entityType] || l.entityType)}</strong>
              <span class="muted small">${esc(new Date(l.timestamp).toLocaleString('id-ID'))}</span>
            </header>
            <p class="log-summary">${esc(summaryOf(l))}</p>
            ${l.action === 'update' ? diffHTML(l.oldData, l.newData) : ''}
            ${l.action === 'delete' && l.oldData?.date ? `<p class="muted small">Dihapus dari tanggal ${esc(formatDateLong(l.oldData.date))}. Data tetap tersimpan untuk audit.</p>` : ''}
            <p class="muted small">ID: ${esc(l.entityId)}</p>
          </article>`).join('')}</section>`
      : `<div class="empty card">${icon('list')}<p>Belum ada catatan aktivitas.</p></div>`}`;
}

const changes = {
  'log-filter': (el) => {
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const key = el.dataset.key;
    if (el.value === 'all') qs.delete(key);
    else qs.set(key, el.value);
    const s = qs.toString();
    location.hash = `#/log${s ? `?${s}` : ''}`;
  },
};

export default {
  title: () => 'Log aktivitas',
  render,
  actions: {},
  forms: { 'log-noop': () => {} },
  changes,
};
