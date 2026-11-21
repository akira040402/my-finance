// Validasi input dan struktur data. Semua fungsi murni dan dapat diuji.
import { parseRupiah, isValidISODate, isValidTime } from './money.js';
import { TYPE } from './ledger.js';

export const SCHEMA_VERSION = 1;
export const STORE_NAMES = ['accounts', 'transactions', 'transfers', 'categories', 'activity_logs', 'settings'];

const isInt = (n) => Number.isSafeInteger(n);

/** Validasi input transaksi pemasukan/pengeluaran. Mengembalikan { ok, errors, value }. */
export function validateTransaction(input, data) {
  const errors = {};
  const type = input.type;
  if (type !== TYPE.INCOME && type !== TYPE.EXPENSE) errors.type = 'Jenis transaksi tidak valid.';

  const accountIds = new Set(data.accounts.filter((a) => !a.archivedAt).map((a) => a.id));
  if (!accountIds.has(input.accountId)) errors.accountId = 'Pilih ATM yang aktif.';

  const amount = parseRupiah(input.amount);
  if (!isInt(amount) || amount <= 0) errors.amount = 'Nominal harus lebih dari 0.';

  if (!isValidISODate(input.date)) errors.date = 'Tanggal tidak valid.';
  if (!isValidTime(input.time)) errors.time = 'Jam tidak valid (HH:MM).';

  if (input.categoryId) {
    const cat = data.categories.find((c) => c.id === input.categoryId);
    if (!cat) errors.categoryId = 'Kategori tidak ditemukan.';
    else if (cat.type !== type) errors.categoryId = 'Kategori tidak sesuai dengan jenis transaksi.';
  } else {
    errors.categoryId = 'Pilih kategori.';
  }

  const description = String(input.description ?? '').trim();
  if (description.length > 300) errors.description = 'Keterangan maksimal 300 karakter.';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      type,
      accountId: input.accountId,
      amount,
      date: input.date,
      time: input.time,
      categoryId: input.categoryId || null,
      source: String(input.source ?? '').trim().slice(0, 120),
      purpose: String(input.purpose ?? '').trim().slice(0, 120),
      description: description.slice(0, 300),
    },
  };
}

/** Validasi transfer antar-ATM. */
export function validateTransfer(input, data) {
  const errors = {};
  const active = new Map(data.accounts.filter((a) => !a.archivedAt).map((a) => [a.id, a]));
  if (!active.has(input.fromAccountId)) errors.fromAccountId = 'Pilih ATM asal yang aktif.';
  if (!active.has(input.toAccountId)) errors.toAccountId = 'Pilih ATM tujuan yang aktif.';
  if (input.fromAccountId && input.fromAccountId === input.toAccountId) {
    errors.toAccountId = 'ATM asal dan tujuan harus berbeda.';
  }
  const amount = parseRupiah(input.amount);
  if (!isInt(amount) || amount <= 0) errors.amount = 'Nominal harus lebih dari 0.';

  let fee = 0;
  if (String(input.fee ?? '').trim() !== '') {
    fee = parseRupiah(input.fee);
    if (!isInt(fee) || fee < 0) errors.fee = 'Biaya admin tidak valid.';
  }
  if (!isValidISODate(input.date)) errors.date = 'Tanggal tidak valid.';
  if (!isValidTime(input.time)) errors.time = 'Jam tidak valid (HH:MM).';
  const description = String(input.description ?? '').trim();
  if (description.length > 300) errors.description = 'Keterangan maksimal 300 karakter.';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount,
      fee: isInt(fee) ? fee : 0,
      date: input.date,
      time: input.time,
      description: description.slice(0, 300),
    },
  };
}

/** Validasi nama ATM & saldo awal. */
export function validateAccount(input, existing = []) {
  const errors = {};
  const name = String(input.name ?? '').trim();
  if (name.length < 1) errors.name = 'Nama ATM wajib diisi.';
  if (name.length > 60) errors.name = 'Nama ATM maksimal 60 karakter.';
  const dup = existing.some((a) => a.id !== input.id && !a.archivedAt && a.name.toLowerCase() === name.toLowerCase());
  if (dup) errors.name = 'Nama ATM sudah dipakai.';
  let initialBalance = 0;
  if (String(input.initialBalance ?? '').trim() !== '') {
    initialBalance = parseRupiah(input.initialBalance);
    if (!isInt(initialBalance)) errors.initialBalance = 'Saldo awal tidak valid.';
  }
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { name, initialBalance: isInt(initialBalance) ? initialBalance : 0, note: String(input.note ?? '').trim().slice(0, 200) },
  };
}

/** Validasi nama kategori. */
export function validateCategory(input, existing = []) {
  const errors = {};
  const name = String(input.name ?? '').trim();
  if (!name) errors.name = 'Nama kategori wajib diisi.';
  if (name.length > 40) errors.name = 'Nama kategori maksimal 40 karakter.';
  const dup = existing.some((c) => c.id !== input.id && c.type === input.type && c.name.toLowerCase() === name.toLowerCase());
  if (dup) errors.name = 'Kategori dengan nama ini sudah ada.';
  return { ok: Object.keys(errors).length === 0, errors, value: { name, type: input.type } };
}

/**
 * Validasi file backup (objek JSON yang sudah di-parse).
 * Mengembalikan { ok, errors[], counts } tanpa menulis apa pun.
 */
export function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['File bukan objek JSON yang valid.'], counts: null };
  if (obj.app !== 'MY FINANCE') errors.push('File ini bukan backup MY FINANCE.');
  if (!isInt(obj.schemaVersion)) errors.push('Versi skema tidak ditemukan.');
  else if (obj.schemaVersion > SCHEMA_VERSION) errors.push(`Versi skema ${obj.schemaVersion} lebih baru dari aplikasi ini (${SCHEMA_VERSION}).`);
  const d = obj.data;
  if (!d || typeof d !== 'object') return { ok: false, errors: [...errors, 'Bagian data tidak ditemukan.'], counts: null };

  const arrays = ['accounts', 'transactions', 'transfers', 'categories', 'activity_logs'];
  for (const key of arrays) {
    if (!Array.isArray(d[key])) errors.push(`Bagian "${key}" harus berupa daftar.`);
  }
  if (errors.length) return { ok: false, errors, counts: null };

  const ids = (list, label) => {
    const set = new Set();
    list.forEach((r, i) => {
      if (!r || typeof r.id !== 'string' || !r.id) errors.push(`${label} baris ${i + 1}: ID tidak valid.`);
      else if (set.has(r.id)) errors.push(`${label}: ID ganda ${r.id}.`);
      else set.add(r.id);
    });
    return set;
  };
  const accIds = ids(d.accounts, 'ATM');
  const catIds = ids(d.categories, 'Kategori');
  ids(d.transactions, 'Transaksi');
  ids(d.transfers, 'Transfer');
  ids(d.activity_logs, 'Log');

  d.accounts.forEach((a, i) => {
    if (typeof a.name !== 'string' || !a.name.trim()) errors.push(`ATM baris ${i + 1}: nama kosong.`);
    if (!isInt(a.initialBalance)) errors.push(`ATM baris ${i + 1}: saldo awal harus integer.`);
  });
  d.transactions.forEach((t, i) => {
    if (t.type !== TYPE.INCOME && t.type !== TYPE.EXPENSE) errors.push(`Transaksi baris ${i + 1}: jenis tidak valid.`);
    if (!isInt(t.amount) || t.amount <= 0) errors.push(`Transaksi baris ${i + 1}: nominal harus integer > 0.`);
    if (!accIds.has(t.accountId)) errors.push(`Transaksi baris ${i + 1}: ATM tidak ditemukan.`);
    if (!isValidISODate(t.date)) errors.push(`Transaksi baris ${i + 1}: tanggal tidak valid.`);
    if (t.categoryId && !catIds.has(t.categoryId)) errors.push(`Transaksi baris ${i + 1}: kategori tidak ditemukan.`);
  });
  d.transfers.forEach((tr, i) => {
    if (!accIds.has(tr.fromAccountId) || !accIds.has(tr.toAccountId)) errors.push(`Transfer baris ${i + 1}: ATM tidak ditemukan.`);
    if (tr.fromAccountId === tr.toAccountId) errors.push(`Transfer baris ${i + 1}: asal dan tujuan sama.`);
    if (!isInt(tr.amount) || tr.amount <= 0) errors.push(`Transfer baris ${i + 1}: nominal harus integer > 0.`);
    if (tr.fee !== undefined && (!isInt(tr.fee) || tr.fee < 0)) errors.push(`Transfer baris ${i + 1}: biaya admin tidak valid.`);
    if (!isValidISODate(tr.date)) errors.push(`Transfer baris ${i + 1}: tanggal tidak valid.`);
  });
  return {
    ok: errors.length === 0,
    errors: errors.slice(0, 50),
    totalErrors: errors.length,
    counts: {
      accounts: d.accounts.length,
      transactions: d.transactions.length,
      transfers: d.transfers.length,
      categories: d.categories.length,
      activity_logs: d.activity_logs.length,
    },
  };
}
