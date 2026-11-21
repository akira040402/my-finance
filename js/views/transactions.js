// Form & aksi transaksi: pemasukan, pengeluaran, transfer (satu rekaman = dua sisi), detail, edit, hapus.
import { state, refresh } from '../state.js';
import { createTransaction, updateTransaction, deleteTransaction, createTransfer, updateTransfer, deleteTransfer, ValidationError } from '../services/finance.js';
import { computeBalances } from '../core/ledger.js';
import { formatRupiah, formatNumber, formatDateLong, dayNameID, toISOTime } from '../core/money.js';
import { esc, icon, amt, optionList, fieldError, openModal, closeModal, confirmDialog, toast, todayISO, errorMessage } from '../ui/dom.js';

const TYPE_LABEL = { income: 'Pemasukan', expense: 'Pengeluaran', transfer: 'Transfer' };
export const typeLabel = (k) => TYPE_LABEL[k] || k;

const accountName = (id) => state.data?.accounts.find((a) => a.id === id)?.name || 'ATM dihapus';
const categoryName = (id) => state.data?.categories.find((c) => c.id === id)?.name || '—';

function activeAccounts(includeId = null) {
  return state.data.accounts.filter((a) => !a.archivedAt || a.id === includeId);
}

/* ---------- Form pemasukan / pengeluaran ---------- */

export function openTxForm({ type, editing = null, values = null, errors = {} }) {
  const isEdit = !!editing;
  const v = values || (editing
    ? {
        accountId: editing.accountId,
        amount: formatNumber(editing.amount),
        date: editing.date,
        time: editing.time,
        categoryId: editing.categoryId || '',
        source: editing.source || '',
        purpose: editing.purpose || '',
        description: editing.description || '',
      }
    : { accountId: '', amount: '', date: todayISO(), time: toISOTime(), categoryId: '', source: '', purpose: '', description: '' });
  const t = isEdit ? editing.type : type;
  const accounts = activeAccounts(isEdit ? editing.accountId : null);
  const cats = state.data.categories.filter((c) => c.type === t).map((c) => ({ value: c.id, label: c.name }));
  const balanceHint = v.accountId
    ? `Saldo saat ini: ${formatRupiah(computeBalances(state.data).byAccount.get(v.accountId) ?? 0)}`
    : 'Pilih ATM untuk melihat saldonya.';
  const oldBox = isEdit
    ? `<div class="old-data"><div class="old-title">Data lama</div>
        <dl class="kv">
          <dt>Nominal</dt><dd>${amt(editing.amount, t === 'income' ? 'in' : 'out')}</dd>
          <dt>Tanggal</dt><dd>${esc(formatDateLong(editing.date))} · ${esc(editing.time)}</dd>
          <dt>ATM</dt><dd>${esc(accountName(editing.accountId))}</dd>
          <dt>Kategori</dt><dd>${esc(categoryName(editing.categoryId))}</dd>
        </dl></div>`
    : '';
  const sourceField = t === 'income'
    ? `<label class="field"><span>Sumber pemasukan</span><input name="source" value="${esc(v.source)}" maxlength="120" placeholder="Contoh: Kantor, klien, orang tua"></label>`
    : `<label class="field"><span>Keperluan</span><input name="purpose" value="${esc(v.purpose)}" maxlength="120" placeholder="Contoh: makan siang bersama tim"></label>`;

  openModal({
    title: `${isEdit ? 'Edit' : 'Tambah'} ${typeLabel(t).toLowerCase()}`,
    wide: true,
    body: `
      ${oldBox}
      <form id="tx-form" data-form="tx-save" class="form-grid" autocomplete="off">
        <input type="hidden" name="id" value="${esc(isEdit ? editing.id : '')}">
        <input type="hidden" name="type" value="${esc(t)}">
        <label class="field"><span>${t === 'income' ? 'ATM tujuan' : 'ATM asal'}</span>
          <select name="accountId" data-change="acc-hint" required>${optionList(accounts.map((a) => ({ value: a.id, label: a.name + (a.archivedAt ? ' (diarsipkan)' : '') })), v.accountId, { placeholder: '— pilih ATM —' })}</select>
          ${fieldError(errors, 'accountId')}<small class="hint" id="acc-hint">${esc(balanceHint)}</small></label>
        <label class="field"><span>Nominal (Rp)</span>
          <input name="amount" inputmode="numeric" value="${esc(v.amount)}" placeholder="0" required>
          ${fieldError(errors, 'amount')}</label>
        <label class="field"><span>Tanggal</span><input name="date" type="date" value="${esc(v.date)}" required>${fieldError(errors, 'date')}</label>
        <label class="field"><span>Jam</span><input name="time" type="time" value="${esc(v.time)}" required>${fieldError(errors, 'time')}</label>
        <label class="field"><span>Kategori</span>
          <select name="categoryId" required>${optionList(cats, v.categoryId, { placeholder: '— pilih kategori —' })}</select>
          ${fieldError(errors, 'categoryId')}<small class="hint"><a href="#/pengaturan">Kelola kategori</a></small></label>
        ${sourceField}
        <label class="field span-2"><span>Keterangan</span><input name="description" value="${esc(v.description)}" maxlength="300" placeholder="Catatan singkat (opsional)">${fieldError(errors, 'description')}</label>
        <div class="modal-actions span-2">
          <button type="button" class="btn btn-ghost" data-action="modal-close">Batal</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Simpan perubahan' : 'Simpan'}</button>
        </div>
      </form>`,
  });
}

function readForm(form) {
  const fd = new FormData(form);
  return Object.fromEntries([...fd.entries()].map(([k, val]) => [k, String(val)]));
}

/* ---------- Form transfer ---------- */

export function openTransferForm({ editing = null, values = null, errors = {}, fromAccountId = '' } = {}) {
  const isEdit = !!editing;
  const v = values || (editing
    ? {
        fromAccountId: editing.fromAccountId,
        toAccountId: editing.toAccountId,
        amount: formatNumber(editing.amount),
        fee: editing.fee ? formatNumber(editing.fee) : '',
        date: editing.date,
        time: editing.time,
        description: editing.description || '',
      }
    : { fromAccountId, toAccountId: '', amount: '', fee: '', date: todayISO(), time: toISOTime(), description: '' });
  const from = isEdit ? editing.fromAccountId : null;
  const to = isEdit ? editing.toAccountId : null;
  const accOpts = (sel, extra) =>
    optionList(
      state.data.accounts
        .filter((a) => !a.archivedAt || a.id === extra)
        .map((a) => ({ value: a.id, label: a.name + (a.archivedAt ? ' (diarsipkan)' : '') })),
      sel,
      { placeholder: '— pilih ATM —' },
    );
  const oldBox = isEdit
    ? `<div class="old-data"><div class="old-title">Data lama</div>
        <dl class="kv">
          <dt>Dari</dt><dd>${esc(accountName(editing.fromAccountId))}</dd>
          <dt>Ke</dt><dd>${esc(accountName(editing.toAccountId))}</dd>
          <dt>Nominal</dt><dd>${amt(editing.amount, 'move')}</dd>
          <dt>Biaya admin</dt><dd>${amt(editing.fee || 0, 'out')}</dd>
          <dt>Tanggal</dt><dd>${esc(formatDateLong(editing.date))} · ${esc(editing.time)}</dd>
        </dl></div>`
    : '';
  openModal({
    title: `${isEdit ? 'Edit' : 'Buat'} transfer`,
    wide: true,
    body: `
      ${oldBox}
      <p class="hint">Transfer memindahkan saldo. Total seluruh saldo tetap, kecuali biaya admin. Kedua sisi disimpan dalam satu catatan sehingga tidak bisa terpisah.</p>
      <form id="transfer-form" data-form="transfer-save" class="form-grid" autocomplete="off">
        <input type="hidden" name="id" value="${esc(isEdit ? editing.id : '')}">
        <label class="field"><span>ATM asal</span><select name="fromAccountId" required>${accOpts(v.fromAccountId, from)}</select>${fieldError(errors, 'fromAccountId')}</label>
        <label class="field"><span>ATM tujuan</span><select name="toAccountId" required>${accOpts(v.toAccountId, to)}</select>${fieldError(errors, 'toAccountId')}</label>
        <label class="field"><span>Nominal (Rp)</span><input name="amount" inputmode="numeric" value="${esc(v.amount)}" placeholder="0" required>${fieldError(errors, 'amount')}</label>
        <label class="field"><span>Biaya admin (Rp)</span><input name="fee" inputmode="numeric" value="${esc(v.fee)}" placeholder="0 jika tidak ada">${fieldError(errors, 'fee')}<small class="hint">Dicatat sebagai pengeluaran terpisah pada laporan.</small></label>
        <label class="field"><span>Tanggal</span><input name="date" type="date" value="${esc(v.date)}" required>${fieldError(errors, 'date')}</label>
        <label class="field"><span>Jam</span><input name="time" type="time" value="${esc(v.time)}" required>${fieldError(errors, 'time')}</label>
        <label class="field span-2"><span>Keterangan</span><input name="description" value="${esc(v.description)}" maxlength="300" placeholder="Contoh: tabungan bulanan">${fieldError(errors, 'description')}</label>
        <div class="modal-actions span-2">
          <button type="button" class="btn btn-ghost" data-action="modal-close">Batal</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Simpan perubahan' : 'Simpan transfer'}</button>
        </div>
      </form>`,
  });
}

/* ---------- Detail ---------- */

function logsFor(id) {
  return (state.data?.activity_logs || [])
    .filter((l) => l.entityId === id)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

export function openTxDetail(id) {
  const t = state.data.transactions.find((x) => x.id === id);
  if (!t) return toast('Transaksi tidak ditemukan.', 'error');
  const deleted = !!t.deletedAt;
  openModal({
    title: 'Detail transaksi',
    body: `
      <div class="detail-head ${t.type}">
        <span class="badge badge-${t.type}">${typeLabel(t.type)}</span>
        ${amt(t.amount, t.type === 'income' ? 'in' : 'out')}
      </div>
      <dl class="kv">
        <dt>Hari</dt><dd>${esc(dayNameID(t.date))}, ${esc(formatDateLong(t.date))}</dd>
        <dt>Jam</dt><dd>${esc(t.time)}</dd>
        <dt>ATM</dt><dd>${esc(accountName(t.accountId))}</dd>
        <dt>Kategori</dt><dd>${esc(categoryName(t.categoryId))}</dd>
        <dt>${t.type === 'income' ? 'Sumber' : 'Keperluan'}</dt><dd>${esc((t.type === 'income' ? t.source : t.purpose) || '—')}</dd>
        <dt>Keterangan</dt><dd>${esc(t.description || '—')}</dd>
        <dt>Dicatat</dt><dd>${esc(new Date(t.createdAt).toLocaleString('id-ID'))}</dd>
      </dl>
      ${deleted ? '<p class="field-error">Transaksi ini sudah dihapus. Riwayat tetap tersimpan di log.</p>' : ''}
      ${logBlock(id)}`,
    footer: deleted ? '' : `
      <button class="btn btn-danger" data-action="tx-delete" data-id="${esc(t.id)}">${icon('trash')}Hapus</button>
      <button class="btn btn-primary" data-action="tx-edit" data-id="${esc(t.id)}">${icon('edit')}Edit</button>`,
  });
}

export function openTransferDetail(id) {
  const tr = state.data.transfers.find((x) => x.id === id);
  if (!tr) return toast('Transfer tidak ditemukan.', 'error');
  const deleted = !!tr.deletedAt;
  openModal({
    title: 'Detail transfer',
    body: `
      <div class="detail-head transfer"><span class="badge badge-transfer">Transfer</span>${amt(tr.amount, 'move')}</div>
      <dl class="kv">
        <dt>Hari</dt><dd>${esc(dayNameID(tr.date))}, ${esc(formatDateLong(tr.date))}</dd>
        <dt>Jam</dt><dd>${esc(tr.time)}</dd>
        <dt>Dari</dt><dd>${esc(accountName(tr.fromAccountId))}</dd>
        <dt>Ke</dt><dd>${esc(accountName(tr.toAccountId))}</dd>
        <dt>Biaya admin</dt><dd>${amt(tr.fee || 0, 'out')}</dd>
        <dt>Keterangan</dt><dd>${esc(tr.description || '—')}</dd>
      </dl>
      ${deleted ? '<p class="field-error">Transfer ini sudah dihapus.</p>' : ''}
      ${logBlock(id)}`,
    footer: deleted ? '' : `
      <button class="btn btn-danger" data-action="transfer-delete" data-id="${esc(tr.id)}">${icon('trash')}Hapus</button>
      <button class="btn btn-primary" data-action="transfer-edit" data-id="${esc(tr.id)}">${icon('edit')}Edit</button>`,
  });
}

function logBlock(id) {
  const logs = logsFor(id);
  if (!logs.length) return '';
  return `<details class="log-inline"><summary>Riwayat perubahan (${logs.length})</summary>
    <ul class="log-list">${logs
      .map((l) => `<li><strong>${esc(actionLabel(l.action))}</strong> <span class="muted">${esc(new Date(l.timestamp).toLocaleString('id-ID'))}</span></li>`)
      .join('')}</ul></details>`;
}

const ACTION_LABEL = {
  create: 'Ditambahkan', update: 'Diedit', delete: 'Dihapus', archive: 'Diarsipkan',
  unarchive: 'Diaktifkan kembali', import: 'Impor dilakukan', backup: 'Backup dibuat', restore: 'Restore dilakukan',
};
export const actionLabel = (a) => ACTION_LABEL[a] || a;

/* ---------- Aksi ---------- */

const actions = {
  'tx-new': (el) => {
    closeModal();
    openTxForm({ type: el.dataset.type });
  },
  'tx-view': (el) => openTxDetail(el.dataset.id),
  'tx-edit': (el) => {
    const t = state.data.transactions.find((x) => x.id === el.dataset.id);
    if (!t || t.deletedAt) return toast('Transaksi tidak ditemukan.', 'error');
    openTxForm({ type: t.type, editing: t });
  },
  'tx-delete': async (el) => {
    const id = el.dataset.id;
    const ok = await confirmDialog('Transaksi ini akan dihapus dari saldo dan laporan. Riwayat penghapusan tetap tercatat di log.', {
      title: 'Hapus transaksi?', confirmText: 'Hapus', danger: true,
    });
    if (!ok) return;
    await deleteTransaction(id);
    closeModal();
    toast('Transaksi dihapus dan tercatat di log.');
    await refresh();
  },
  'transfer-new': (el) => {
    closeModal();
    openTransferForm({ fromAccountId: el.dataset.account || '' });
  },
  'transfer-view': (el) => openTransferDetail(el.dataset.id),
  'transfer-edit': (el) => {
    const tr = state.data.transfers.find((x) => x.id === el.dataset.id);
    if (!tr || tr.deletedAt) return toast('Transfer tidak ditemukan.', 'error');
    openTransferForm({ editing: tr });
  },
  'transfer-delete': async (el) => {
    const ok = await confirmDialog('Transfer dihapus untuk kedua ATM sekaligus. Saldo kedua ATM akan kembali seperti sebelum transfer.', {
      title: 'Hapus transfer?', confirmText: 'Hapus', danger: true,
    });
    if (!ok) return;
    await deleteTransfer(el.dataset.id);
    closeModal();
    toast('Transfer dihapus dari kedua ATM dan tercatat di log.');
    await refresh();
  },
  'row-open': (el) => {
    if (el.dataset.kind === 'transfer') openTransferDetail(el.dataset.id);
    else openTxDetail(el.dataset.id);
  },
};

const forms = {
  'tx-save': async (form) => {
    const raw = readForm(form);
    const { id, type, ...rest } = raw;
    try {
      if (id) await updateTransaction(id, { ...rest, type });
      else await createTransaction({ ...rest, type });
      closeModal();
      toast(id ? 'Perubahan transaksi disimpan dan tercatat di log.' : `${typeLabel(type)} dicatat.`);
      await refresh();
    } catch (err) {
      if (err instanceof ValidationError) {
        openTxForm({ type, editing: id ? state.data.transactions.find((t) => t.id === id) : null, values: rest, errors: err.errors });
        return;
      }
      throw err;
    }
  },
  'transfer-save': async (form) => {
    const raw = readForm(form);
    const { id, ...rest } = raw;
    try {
      if (id) await updateTransfer(id, rest);
      else await createTransfer(rest);
      closeModal();
      toast(id ? 'Transfer diperbarui untuk kedua ATM.' : 'Transfer berhasil dicatat.');
      await refresh();
    } catch (err) {
      if (err instanceof ValidationError) {
        openTransferForm({ editing: id ? state.data.transfers.find((t) => t.id === id) : null, values: rest, errors: err.errors });
        return;
      }
      throw err;
    }
  },
};

const changes = {
  'acc-hint': (el) => {
    const hint = document.getElementById('acc-hint');
    if (!hint) return;
    hint.textContent = el.value
      ? `Saldo saat ini: ${formatRupiah(computeBalances(state.data).byAccount.get(el.value) ?? 0)}`
      : 'Pilih ATM untuk melihat saldonya.';
  },
};

export default { actions, forms, changes };
