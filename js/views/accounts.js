// Manajemen ATM: daftar, detail (saldo, statistik, riwayat), tambah/edit, arsip, hapus.
import { state, refresh } from '../state.js';
import { createAccount, updateAccount, setAccountArchived, deleteAccount, ValidationError } from '../services/finance.js';
import { computeBalances, summarize, toRows, filterRows, isCountedInTotal } from '../core/ledger.js';
import { formatRupiah, formatNumber } from '../core/money.js';
import { esc, icon, fieldError, openModal, closeModal, confirmDialog, toast } from '../ui/dom.js';
import { rowsHTML } from '../ui/rows.js';

function openAccountForm({ editing = null, values = null, errors = {} } = {}) {
  const isEdit = !!editing;
  const v = values || (editing
    ? {
        name: editing.name,
        initialBalance: formatNumber(editing.initialBalance),
        note: editing.note || '',
        includeInTotal: editing.includeInTotal !== false,
      }
    : { name: '', initialBalance: '', note: '', includeInTotal: true });
  const includeChecked = values ? values.includeInTotal === 'on' : v.includeInTotal;
  openModal({
    title: isEdit ? 'Edit info ATM' : 'Tambah ATM',
    body: `
      ${isEdit ? `<div class="old-data"><div class="old-title">Data lama</div>
        <dl class="kv"><dt>Nama</dt><dd>${esc(editing.name)}</dd>
        <dt>Saldo awal</dt><dd>${esc(formatRupiah(editing.initialBalance))}</dd></dl></div>` : ''}
      <form id="account-form" data-form="account-save" class="stack" autocomplete="off">
        <input type="hidden" name="id" value="${esc(isEdit ? editing.id : '')}">
        <label class="field"><span>Nama ATM</span>
          <input name="name" value="${esc(v.name)}" maxlength="60" placeholder="Contoh: ATM A, Dompet, Tabungan" required>${fieldError(errors, 'name')}</label>
        <label class="field"><span>Saldo awal (Rp)</span>
          <input name="initialBalance" inputmode="numeric" value="${esc(v.initialBalance)}" placeholder="0">
          ${fieldError(errors, 'initialBalance')}<small class="hint">Saldo awal ditambahkan ke transaksi untuk menghitung saldo terkini.</small></label>
        <label class="field"><span>Catatan (opsional)</span><input name="note" value="${esc(v.note)}" maxlength="200"></label>
        <label class="check"><input type="checkbox" name="includeInTotal" ${includeChecked ? 'checked' : ''}> Ikut dihitung dalam total seluruh saldo</label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="modal-close">Batal</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Simpan' : 'Tambah ATM'}</button>
        </div>
      </form>`,
  });
}

function accountRefs(id) {
  const tx = state.data.transactions.filter((t) => t.accountId === id).length;
  const tr = state.data.transfers.filter((t) => t.fromAccountId === id || t.toAccountId === id).length;
  return tx + tr;
}

function listView({ data, query }) {
  const showArchived = query.get('arsip') === '1';
  const { byAccount } = computeBalances(data);
  const accounts = data.accounts
    .filter((a) => (showArchived ? true : !a.archivedAt))
    .sort((a, b) => (a.archivedAt ? 1 : 0) - (b.archivedAt ? 1 : 0) || a.name.localeCompare(b.name, 'id'));
  const cards = accounts.length
    ? accounts
        .map((a) => `
          <a class="acc-card ${a.archivedAt ? 'archived' : ''}" href="#/atm/${esc(a.id)}">
            <div class="acc-card-head"><span class="acc-dot"></span><strong>${esc(a.name)}</strong>
              ${a.archivedAt ? '<span class="badge badge-muted">Diarsipkan</span>' : ''}
              ${!a.archivedAt && !isCountedInTotal(a) ? '<span class="badge badge-muted">Tidak ikut total</span>' : ''}
            </div>
            <div class="acc-card-bal">${esc(formatRupiah(byAccount.get(a.id) ?? 0))}</div>
            <div class="acc-card-foot">Saldo awal ${esc(formatRupiah(a.initialBalance))}</div>
          </a>`)
        .join('')
    : '<div class="empty card"><p>Belum ada ATM. Tambahkan ATM pertama Anda.</p></div>';
  return `
    <div class="actions-bar">
      <button class="btn btn-primary" data-action="account-new">${icon('plus')}Tambah ATM</button>
      <a class="btn btn-ghost" href="#/atm?arsip=${showArchived ? '0' : '1'}">${icon('archive')}${showArchived ? 'Sembunyikan arsip' : 'Tampilkan arsip'}</a>
    </div>
    <div class="acc-grid">${cards}</div>`;
}

function detailView({ data, query }, id) {
  const a = data.accounts.find((x) => x.id === id);
  if (!a) return `<div class="card"><p>ATM tidak ditemukan.</p><a class="link" href="#/atm">Kembali ke daftar ATM</a></div>`;
  const { byAccount } = computeBalances(data);
  const s = summarize(data, { accountIds: [id] });
  const inTr = data.transfers.filter((t) => !t.deletedAt && t.toAccountId === id).reduce((n, t) => n + t.amount, 0);
  const outTr = data.transfers.filter((t) => !t.deletedAt && t.fromAccountId === id).reduce((n, t) => n + t.amount, 0);
  const filter = query.get('jenis') || 'all';
  const rows = filterRows(toRows(data).filter((r) => r.accountId === id || r.toAccountId === id), { kind: filter === 'all' ? 'all' : filter })
    .slice(0, 200);
  const chip = (key, label) =>
    `<a class="chip ${filter === key ? 'active' : ''}" href="#/atm/${esc(id)}?jenis=${key}">${label}</a>`;
  const canDelete = accountRefs(id) === 0;
  return `
    <div class="breadcrumb"><a href="#/atm">ATM</a> / <span>${esc(a.name)}</span></div>
    <section class="card hero-balance">
      <div>
        <span class="stat-label">Saldo terkini ${a.archivedAt ? '· diarsipkan' : ''}</span>
        <strong class="big">${esc(formatRupiah(byAccount.get(id) ?? 0))}</strong>
        <span class="stat-foot">${isCountedInTotal(a) ? 'Ikut total seluruh saldo' : 'Tidak ikut total seluruh saldo'}</span>
      </div>
      <div class="hero-actions">
        ${a.archivedAt ? '' : `
          <button class="btn btn-in" data-action="tx-new" data-type="income" data-account="${esc(id)}">${icon('arrowDown')}Pemasukan</button>
          <button class="btn btn-out" data-action="tx-new" data-type="expense" data-account="${esc(id)}">${icon('arrowUp')}Pengeluaran</button>
          <button class="btn btn-move" data-action="transfer-new" data-account="${esc(id)}">${icon('transfer')}Transfer</button>`}
      </div>
    </section>

    <section class="stats stats-4">
      <article class="stat"><span class="stat-label">Saldo awal</span><strong class="stat-value">${esc(formatRupiah(a.initialBalance))}</strong></article>
      <article class="stat"><span class="stat-label">Pemasukan</span><strong class="stat-value amt-in">${esc(formatRupiah(s.income))}</strong></article>
      <article class="stat"><span class="stat-label">Pengeluaran (+biaya)</span><strong class="stat-value amt-out">${esc(formatRupiah(s.expense))}</strong></article>
      <article class="stat"><span class="stat-label">Transfer masuk / keluar</span><strong class="stat-value amt-move">${esc(formatRupiah(inTr))} / ${esc(formatRupiah(outTr))}</strong></article>
    </section>

    <section class="card">
      <header class="card-head">
        <h2>Riwayat ATM</h2>
        <div class="chips">${chip('all', 'Semua')}${chip('income', 'Pemasukan')}${chip('expense', 'Pengeluaran')}${chip('transfer', 'Transfer')}</div>
      </header>
      ${rowsHTML(rows, { showDate: true })}
    </section>

    <section class="card">
      <header class="card-head"><h2>Pengaturan ATM</h2></header>
      <div class="btn-row">
        <button class="btn btn-ghost" data-action="account-edit" data-id="${esc(id)}">${icon('edit')}Edit nama, saldo awal & info</button>
        ${a.archivedAt
          ? `<button class="btn btn-ghost" data-action="account-archive" data-id="${esc(id)}" data-archive="0">${icon('check')}Aktifkan kembali</button>`
          : `<button class="btn btn-ghost" data-action="account-archive" data-id="${esc(id)}" data-archive="1">${icon('archive')}Arsipkan</button>`}
        <button class="btn btn-danger-ghost" data-action="account-delete" data-id="${esc(id)}" ${canDelete ? '' : 'disabled title="ATM yang sudah punya transaksi tidak bisa dihapus; arsipkan saja."'}>${icon('trash')}Hapus ATM</button>
      </div>
      ${canDelete ? '' : '<p class="hint">ATM yang sudah punya transaksi tidak bisa dihapus. Gunakan arsip agar riwayat tetap aman.</p>'}
    </section>`;
}

export default {
  title: ({ args, data }) => {
    if (args[0]) return data.accounts.find((a) => a.id === args[0])?.name || 'ATM';
    return 'ATM';
  },
  render(ctx) {
    if (ctx.args[0]) return detailView(ctx, ctx.args[0]);
    return listView(ctx);
  },
  actions: {
    'account-new': () => {
      closeModal();
      openAccountForm();
    },
    'account-edit': (el) => {
      const a = state.data.accounts.find((x) => x.id === el.dataset.id);
      if (a) openAccountForm({ editing: a });
    },
    'account-archive': async (el) => {
      const archive = el.dataset.archive === '1';
      if (archive) {
        const ok = await confirmDialog('ATM yang diarsipkan tidak bisa dipakai untuk transaksi baru dan tidak dihitung dalam total. Riwayatnya tetap tersimpan.', {
          title: 'Arsipkan ATM?', confirmText: 'Arsipkan',
        });
        if (!ok) return;
      }
      await setAccountArchived(el.dataset.id, archive);
      toast(archive ? 'ATM diarsipkan.' : 'ATM diaktifkan kembali.');
      await refresh();
    },
    'account-delete': async (el) => {
      const a = state.data.accounts.find((x) => x.id === el.dataset.id);
      const ok = await confirmDialog(`ATM "${a?.name}" akan dihapus permanen. Hanya ATM tanpa riwayat yang bisa dihapus.`, {
        title: 'Hapus ATM?', confirmText: 'Hapus', danger: true,
      });
      if (!ok) return;
      await deleteAccount(el.dataset.id);
      toast('ATM dihapus dan tercatat di log.');
      location.hash = '#/atm';
      await refresh();
    },
  },
  forms: {
    'account-save': async (form) => {
      const fd = new FormData(form);
      const id = String(fd.get('id') || '');
      const input = {
        name: String(fd.get('name') || ''),
        initialBalance: String(fd.get('initialBalance') || ''),
        note: String(fd.get('note') || ''),
        includeInTotal: form.includeInTotal.checked,
      };
      try {
        if (id) await updateAccount(id, input);
        else await createAccount(input);
        closeModal();
        toast(id ? 'Info ATM diperbarui dan tercatat di log.' : 'ATM ditambahkan.');
        await refresh();
      } catch (err) {
        if (err instanceof ValidationError) {
          openAccountForm({
            editing: id ? state.data.accounts.find((a) => a.id === id) : null,
            values: { ...input, includeInTotal: input.includeInTotal ? 'on' : '' },
            errors: err.errors,
          });
          return;
        }
        throw err;
      }
    },
  },
  changes: {},
};
