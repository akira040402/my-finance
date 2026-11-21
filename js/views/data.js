// Data & backup: impor/ekspor CSV (dengan pratinjau), backup JSON (opsional terenkripsi), restore atomik.
import { state, bus, refresh } from '../state.js';
import { parseCSV, toCSV, guessMapping } from '../core/csv.js';
import { prepareImport, EXPORT_COLUMNS } from '../core/importer.js';
import { validateBackup } from '../core/validate.js';
import { toRows, filterRows, TYPE } from '../core/ledger.js';
import { formatRupiah, toISOTime, formatNumber } from '../core/money.js';
import { esc, optionList, toast, confirmDialog, icon, todayISO } from '../ui/dom.js';
import { importTransactions, createBackupText, restoreBackup } from '../services/finance.js';
import { readSettings } from '../database/db.js';
import { decryptEnvelope } from '../core/security.js';

// Keadaan sementara halaman (tidak disimpan ke database).
let csvPending = null;     // { fileName, parsed, mapping, plan }
let restorePending = null; // { fileName, obj, envelope, validation }

function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const stamp = () => `${todayISO()}-${toISOTime().replace(':', '')}`;

/* ---------- CSV impor ---------- */

const MAP_FIELDS = [
  { key: 'date', label: 'Tanggal *', required: true },
  { key: 'type', label: 'Jenis (pemasukan/pengeluaran) *', required: true },
  { key: 'account', label: 'ATM (nama) *', required: true },
  { key: 'amount', label: 'Nominal *', required: true },
  { key: 'time', label: 'Jam' },
  { key: 'category', label: 'Kategori' },
  { key: 'description', label: 'Keterangan' },
  { key: 'source', label: 'Sumber (pemasukan)' },
  { key: 'purpose', label: 'Keperluan (pengeluaran)' },
];

function csvImportHTML({ data }) {
  if (!csvPending) {
    return `
      <p class="muted">Pilih file CSV dengan header. Aplikasi akan menampilkan pratinjau, meminta pemetaan kolom, memvalidasi setiap baris, dan memeriksa duplikasi sebelum menyimpan.</p>
      <label class="file-drop"><input type="file" accept=".csv,text/csv" data-change="csv-file">${icon('upload')}<span>Pilih file CSV</span></label>
      <p class="hint">Format tanggal: YYYY-MM-DD atau dd/mm/yyyy. Nominal berupa angka bulat rupiah. Nama ATM harus sama dengan ATM yang sudah ada.</p>`;
  }
  const { fileName, parsed, mapping, plan } = csvPending;
  const headerOpts = [{ value: '', label: '— tidak dipakai —' }, ...parsed.headers.map((h) => ({ value: h, label: h }))];
  const mapHTML = MAP_FIELDS.map((f) => `
    <label class="field"><span>${esc(f.label)}</span>
      <select data-change="csv-map" data-key="${f.key}">${optionList(headerOpts, mapping[f.key] || '')}</select></label>`).join('');
  const missing = MAP_FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label.replace(' *', ''));
  const previewRows = plan
    ? plan.valid.slice(0, 8).map((v) => `<tr><td>${v.line}</td><td>${esc(v.row.date)}</td><td>${v.row.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</td><td>${esc(accName(data, v.row.accountId))}</td><td>${esc(v.row.categoryName)}</td><td class="num">${esc(formatRupiah(v.row.amount))}</td></tr>`).join('')
    : '';
  const invalidRows = plan
    ? plan.invalid.slice(0, 30).map((x) => `<li>Baris ${x.line}: ${esc(x.errors.join(' '))}</li>`).join('')
    : '';
  return `
    <div class="pending-head"><strong>${esc(fileName)}</strong> <span class="muted">${parsed.rows.length} baris data</span>
      <button class="btn btn-ghost btn-sm" data-action="csv-reset">${icon('x')}Batal</button></div>
    ${missing.length ? `<p class="field-error">Pemetaan wajib belum lengkap: ${esc(missing.join(', '))}</p>` : ''}
    <div class="form-grid">${mapHTML}</div>
    ${plan ? `
      <div class="stats stats-4 compact">
        <article class="stat"><span class="stat-label">Total baris</span><strong class="stat-value">${plan.counts.total}</strong></article>
        <article class="stat"><span class="stat-label">Valid</span><strong class="stat-value amt-in">${plan.counts.valid}</strong></article>
        <article class="stat"><span class="stat-label">Tidak valid</span><strong class="stat-value amt-out">${plan.counts.invalid}</strong></article>
        <article class="stat"><span class="stat-label">Duplikat (dilewati)</span><strong class="stat-value">${plan.counts.duplicates}</strong></article>
      </div>
      ${plan.newCategories.length ? `<p class="hint">Kategori baru akan dibuat: ${esc(plan.newCategories.map((c) => c.name).join(', '))}</p>` : ''}
      ${previewRows ? `<div class="table-wrap"><table class="table"><thead><tr><th>Baris</th><th>Tanggal</th><th>Jenis</th><th>ATM</th><th>Kategori</th><th class="num">Nominal</th></tr></thead><tbody>${previewRows}</tbody></table></div>` : ''}
      ${plan.valid.length > 8 ? `<p class="hint">Menampilkan 8 dari ${plan.valid.length} baris valid.</p>` : ''}
      ${invalidRows ? `<details class="invalid"><summary>Baris tidak valid (${plan.invalid.length})</summary><ul>${invalidRows}</ul></details>` : ''}
      <form data-form="csv-confirm" class="stack">
        <label class="check"><input type="checkbox" name="ok" required> Saya sudah memeriksa pratinjau dan ingin menyimpan ${plan.counts.valid} baris valid.</label>
        <button class="btn btn-primary" type="submit" ${plan.counts.valid && !missing.length ? '' : 'disabled'}>${icon('check')}Impor ${plan.counts.valid} data valid</button>
      </form>` : ''}`;
}

function accName(data, id) {
  return data.accounts.find((a) => a.id === id)?.name || '—';
}

function rebuildPlan() {
  if (!csvPending) return;
  const missing = MAP_FIELDS.some((f) => f.required && !csvPending.mapping[f.key]);
  csvPending.plan = missing ? null : prepareImport(csvPending.parsed, csvPending.mapping, state.data);
}

/* ---------- CSV ekspor ---------- */

function csvExportHTML({ data }) {
  return `
    <form data-form="csv-export" class="filters" autocomplete="off">
      <label class="field"><span>Isi ekspor</span>
        <select name="scope">${optionList([
          { value: 'all', label: 'Semua transaksi & transfer' },
          { value: 'income', label: 'Pemasukan saja' },
          { value: 'expense', label: 'Pengeluaran saja' },
          { value: 'transfer', label: 'Transfer saja' },
        ], 'all')}</select></label>
      <label class="field"><span>ATM</span>
        <select name="acc">${optionList([{ value: 'all', label: 'Semua ATM' }, ...data.accounts.map((a) => ({ value: a.id, label: a.name }))], 'all')}</select></label>
      <label class="field"><span>Kategori</span>
        <select name="kat">${optionList([{ value: '', label: 'Semua kategori' }, ...data.categories.map((c) => ({ value: c.id, label: c.name }))], '')}</select></label>
      <label class="field"><span>Dari tanggal</span><input type="date" name="from"></label>
      <label class="field"><span>Sampai tanggal</span><input type="date" name="to"></label>
      <div class="form-end"><button class="btn btn-primary" type="submit">${icon('download')}Unduh CSV</button></div>
    </form>
    <p class="hint">Format: tanggal ISO (YYYY-MM-DD), nominal bilangan bulat rupiah, UTF-8 dengan BOM agar aman dibuka di Excel. Kolom sama dengan format impor aplikasi ini.</p>`;
}

function exportRecords(data, f) {
  const kindMap = { income: TYPE.INCOME, expense: TYPE.EXPENSE, transfer: TYPE.TRANSFER };
  const rows = filterRows(toRows(data), {
    kind: f.scope === 'all' ? 'all' : kindMap[f.scope],
    accountId: f.acc,
    categoryId: f.kat || '',
    from: f.from || '',
    to: f.to || '',
  });
  const name = (id) => data.accounts.find((a) => a.id === id)?.name || '';
  const catName = (id) => data.categories.find((c) => c.id === id)?.name || '';
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    time: r.time,
    type: r.kind === 'income' ? 'pemasukan' : r.kind === 'expense' ? 'pengeluaran' : 'transfer',
    account: name(r.accountId),
    toAccount: r.toAccountId ? name(r.toAccountId) : '',
    category: catName(r.categoryId),
    amount: r.amount,
    fee: r.fee || '',
    source: r.source,
    purpose: r.purpose,
    description: r.description,
  }));
}

/* ---------- Backup & restore ---------- */

function backupHTML() {
  const last = state.settings?.appPreferences?.lastBackupAt;
  return `
    <p class="muted">Backup berisi seluruh ATM, transaksi, transfer, kategori, dan log aktivitas dalam satu file JSON. PIN tidak ikut diekspor.</p>
    <p class="hint">Backup terakhir: ${last ? esc(new Date(last).toLocaleString('id-ID')) : '<span class="field-error">belum pernah dibuat</span>'}</p>
    <form data-form="backup-create" class="filters" autocomplete="off">
      <label class="field"><span>Kata sandi file (opsional)</span><input type="password" name="pass" autocomplete="new-password" placeholder="Kosongkan untuk tanpa enkripsi"></label>
      <label class="field"><span>Ulangi kata sandi</span><input type="password" name="pass2" autocomplete="new-password"></label>
      <div class="form-end"><button class="btn btn-primary" type="submit">${icon('download')}Buat & unduh backup</button></div>
    </form>
    <p class="hint">Jika memakai kata sandi, file dienkripsi AES-GCM 256-bit dengan kunci dari PBKDF2. Simpan kata sandi di tempat aman; tanpanya file tidak bisa dibuka.</p>`;
}

function restoreHTML() {
  if (!restorePending) {
    return `
      <p class="muted">Restore akan <strong>mengganti seluruh data ATM, transaksi, transfer, dan kategori</strong>. Log aktivitas digabung, tidak dihapus. Proses bersifat atomik: jika gagal di tengah, database lama tetap utuh.</p>
      <label class="file-drop"><input type="file" accept=".json,application/json" data-change="restore-file">${icon('upload')}<span>Pilih file backup (.json)</span></label>`;
  }
  const { fileName, obj, envelope, validation } = restorePending;
  if (envelope && !obj) {
    return `
      <p>File <strong>${esc(fileName)}</strong> terenkripsi. Masukkan kata sandi untuk membukanya.</p>
      <form data-form="restore-decrypt" class="filters">
        <label class="field"><span>Kata sandi backup</span><input type="password" name="pass" required autocomplete="off"></label>
        <div class="form-end"><button class="btn btn-primary" type="submit">Buka file</button>
        <button class="btn btn-ghost" type="button" data-action="restore-reset">Batal</button></div>
      </form>`;
  }
  const c = validation.counts;
  return `
    <div class="pending-head"><strong>${esc(fileName)}</strong>
      <button class="btn btn-ghost btn-sm" data-action="restore-reset">${icon('x')}Batal</button></div>
    ${validation.ok
      ? `<div class="stats stats-4 compact">
          <article class="stat"><span class="stat-label">ATM</span><strong class="stat-value">${c.accounts}</strong></article>
          <article class="stat"><span class="stat-label">Transaksi</span><strong class="stat-value">${c.transactions}</strong></article>
          <article class="stat"><span class="stat-label">Transfer</span><strong class="stat-value">${c.transfers}</strong></article>
          <article class="stat"><span class="stat-label">Kategori</span><strong class="stat-value">${c.categories}</strong></article>
        </div>
        <div class="old-data danger-box">${icon('alert')}<div>
          <strong>Peringatan:</strong> data saat ini (${formatNumber(state.data.transactions.length)} transaksi, ${state.data.accounts.length} ATM) akan diganti dengan isi file ini.
          Unduh backup data saat ini dulu jika ingin menyimpannya.</div></div>
        <div class="btn-row"><button class="btn btn-ghost" data-action="backup-current">${icon('download')}Unduh backup data saat ini</button></div>
        <form data-form="restore-confirm" class="stack">
          <label class="check"><input type="checkbox" name="ok" required> Saya paham data saat ini akan diganti.</label>
          <button class="btn btn-danger" type="submit">Pulihkan & ganti data</button>
        </form>`
      : `<div class="old-data danger-box"><div><strong>File tidak valid:</strong><ul>${validation.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div></div>`}`;
}

/* ---------- Render ---------- */

function render(ctx) {
  return `
    <section class="card">
      <header class="card-head"><h2>${icon('upload')} Impor CSV</h2></header>
      ${csvImportHTML(ctx)}
    </section>
    <section class="card">
      <header class="card-head"><h2>${icon('download')} Ekspor CSV</h2></header>
      ${csvExportHTML(ctx)}
    </section>
    <section class="card">
      <header class="card-head"><h2>${icon('archive')} Backup</h2></header>
      ${backupHTML()}
    </section>
    <section class="card">
      <header class="card-head"><h2>${icon('history')} Restore</h2></header>
      ${restoreHTML()}
    </section>`;
}

/* ---------- Aksi & form ---------- */

const changes = {
  'csv-file': async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.headers.length || !parsed.rows.length) throw new Error('File CSV kosong atau hanya berisi header.');
    csvPending = { fileName: file.name, parsed, mapping: guessMapping(parsed.headers), plan: null };
    rebuildPlan();
    rerender();
  },
  'csv-map': (el) => {
    if (!csvPending) return;
    csvPending.mapping[el.dataset.key] = el.value;
    rebuildPlan();
    rerender();
  },
  'restore-file': async (el) => {
    const file = el.files?.[0];
    if (!file) return;
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw new Error('File bukan JSON yang valid.');
    }
    if (parsed?.encrypted) {
      restorePending = { fileName: file.name, obj: null, envelope: parsed, validation: null };
    } else {
      restorePending = { fileName: file.name, obj: parsed, envelope: null, validation: validateBackup(parsed) };
    }
    rerender();
  },
};

const actions = {
  'csv-reset': () => {
    csvPending = null;
    rerender();
  },
  'restore-reset': () => {
    restorePending = null;
    rerender();
  },
  'backup-current': async () => {
    await doBackup('');
  },
};

async function doBackup(passphrase) {
  const { text, counts, encrypted } = await createBackupText({ passphrase: passphrase || null });
  const name = `my-finance-backup-${stamp()}${encrypted ? '-terenkripsi' : ''}.json`;
  download(name, text);
  state.settings = await readSettings();
  toast(`Backup dibuat: ${counts.transactions} transaksi, ${counts.accounts} ATM.`);
  rerender();
}

function rerender() {
  bus.render();
}

const forms = {
  'csv-export': (form) => {
    const fd = new FormData(form);
    const records = exportRecords(state.data, {
      scope: String(fd.get('scope')),
      acc: String(fd.get('acc')),
      kat: String(fd.get('kat') || ''),
      from: String(fd.get('from') || ''),
      to: String(fd.get('to') || ''),
    });
    if (!records.length) throw new Error('Tidak ada data yang cocok untuk diekspor.');
    download(`my-finance-${stamp()}.csv`, toCSV(records, EXPORT_COLUMNS), 'text/csv');
    toast(`${records.length} baris diekspor.`);
  },
  'csv-confirm': async (form) => {
    if (!csvPending?.plan) return;
    const { valid, newCategories, counts } = csvPending.plan;
    const ok = await confirmDialog(`Simpan ${counts.valid} transaksi valid? Baris tidak valid (${counts.invalid}) dan duplikat (${counts.duplicates}) dilewati.`, { title: 'Konfirmasi impor', confirmText: 'Impor' });
    if (!ok) return;
    const res = await importTransactions(valid.map((v) => v.row), { newCategories });
    csvPending = null;
    toast(`${res.imported} transaksi diimpor${res.categoriesCreated ? `, ${res.categoriesCreated} kategori baru dibuat` : ''}.`);
    await refresh();
  },
  'backup-create': async (form) => {
    const pass = String(new FormData(form).get('pass') || '');
    const pass2 = String(new FormData(form).get('pass2') || '');
    if (pass && pass.length < 8) throw new Error('Kata sandi backup minimal 8 karakter.');
    if (pass !== pass2) throw new Error('Konfirmasi kata sandi backup tidak sama.');
    await doBackup(pass);
  },
  'restore-decrypt': async (form) => {
    const pass = String(new FormData(form).get('pass') || '');
    const plain = await decryptEnvelope(restorePending.envelope, pass);
    const obj = JSON.parse(plain);
    restorePending = { ...restorePending, obj, envelope: null, validation: validateBackup(obj) };
    rerender();
  },
  'restore-confirm': async () => {
    const ok = await confirmDialog('Semua data saat ini akan diganti dengan isi backup. Tindakan ini tidak bisa dibatalkan.', {
      title: 'Pulihkan backup?', confirmText: 'Ya, pulihkan', danger: true,
    });
    if (!ok) return;
    const counts = await restoreBackup(restorePending.obj);
    restorePending = null;
    toast(`Restore berhasil: ${counts.transactions} transaksi, ${counts.accounts} ATM.`);
    await refresh();
  },
};

export default {
  title: () => 'Data & backup',
  render,
  actions,
  forms,
  changes,
};
