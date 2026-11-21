// Baris riwayat yang dipakai bersama (Beranda, ATM, Riwayat).
import { state } from '../state.js';
import { esc, icon } from './dom.js';
import { formatRupiah } from '../core/money.js';

const accName = (id) => state.data?.accounts.find((a) => a.id === id)?.name || 'ATM dihapus';
const catName = (id) => state.data?.categories.find((c) => c.id === id)?.name || '';

export function rowHTML(r, { showDate = false } = {}) {
  const isTransfer = r.kind === 'transfer';
  const cls = r.kind === 'income' ? 'in' : r.kind === 'expense' ? 'out' : 'move';
  const ic = r.kind === 'income' ? 'arrowDown' : r.kind === 'expense' ? 'arrowUp' : 'transfer';
  const title = isTransfer
    ? `${accName(r.accountId)} → ${accName(r.toAccountId)}`
    : r.description || catName(r.categoryId) || (r.kind === 'income' ? 'Pemasukan' : 'Pengeluaran');
  const sub = isTransfer
    ? (r.fee ? `Biaya admin ${formatRupiah(r.fee)}` : 'Transfer antar-ATM')
    : `${accName(r.accountId)}${catName(r.categoryId) ? ` · ${catName(r.categoryId)}` : ''}`;
  const sign = isTransfer ? '' : r.kind === 'income' ? '+' : '−';
  const when = showDate ? `${r.date.slice(8)}/${r.date.slice(5, 7)} · ${r.time}` : r.time;
  return `
    <button class="row" data-action="row-open" data-id="${esc(r.id)}" data-kind="${esc(r.kind)}">
      <span class="row-ic ${cls}">${icon(ic)}</span>
      <span class="row-main">
        <span class="row-title">${esc(title)}</span>
        <span class="row-sub">${esc(sub)} · ${esc(when)}</span>
      </span>
      <span class="row-amt amt-${cls}">${sign ? esc(sign) + ' ' : ''}${esc(formatRupiah(r.amount))}</span>
    </button>`;
}

export function rowsHTML(rows, opts) {
  if (!rows.length) return '<div class="empty"><p>Belum ada transaksi.</p></div>';
  return `<div class="rows">${rows.map((r) => rowHTML(r, opts)).join('')}</div>`;
}
