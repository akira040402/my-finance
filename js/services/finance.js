// Layanan data: seluruh penulisan dilakukan dalam satu transaksi IndexedDB,
// termasuk entri activity log. Validasi dijalankan ulang di dalam transaksi
// agar tidak ada race antara pengecekan dan penulisan.
import { withTx, readAll, readSettings, SETTINGS_KEY, clearStores, deleteDatabase } from '../database/db.js';
import { newId } from '../core/money.js';
import { validateTransaction, validateTransfer, validateAccount, validateCategory, validateBackup, SCHEMA_VERSION } from '../core/validate.js';
import { encryptText } from '../core/security.js';
import { DEFAULT_CATEGORIES } from './defaults.js';

export class ValidationError extends Error {
  constructor(errors, message = 'Data belum valid.') {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

const TX_STORES = ['accounts', 'categories', 'transactions', 'transfers', 'activity_logs'];
const now = () => new Date().toISOString();
const all = (ctx, name) => ctx.req(ctx.stores[name].getAll());

function log(ctx, entityType, entityId, action, oldData, newData) {
  return ctx.req(
    ctx.stores.activity_logs.put({
      id: newId(),
      entityType,
      entityId,
      action,
      oldData: oldData ?? null,
      newData: newData ?? null,
      timestamp: now(),
    }),
  );
}

/** Muat seluruh data utama (termasuk yang sudah dihapus-lunak, untuk perhitungan & rekonsiliasi). */
export async function loadData() {
  const [accounts, transactions, transfers, categories, activity_logs] = await Promise.all([
    readAll('accounts'),
    readAll('transactions'),
    readAll('transfers'),
    readAll('categories'),
    readAll('activity_logs'),
  ]);
  return { accounts, transactions, transfers, categories, activity_logs };
}

/** Inisialisasi pertama kali: settings default + kategori awal. Idempotent. */
export async function ensureInitialized() {
  const existing = await readSettings();
  if (existing) return existing;
  return withTx(['settings', 'categories'], 'readwrite', async (ctx) => {
    const current = await ctx.req(ctx.stores.settings.get(SETTINGS_KEY));
    if (current) return current;
    const ts = now();
    for (const c of DEFAULT_CATEGORIES) {
      await ctx.req(ctx.stores.categories.put({ id: newId(), ...c, createdAt: ts, updatedAt: ts }));
    }
    const settings = {
      id: SETTINGS_KEY,
      theme: 'light',
      autoLockMinutes: 5,
      securitySettings: { pin: null, failedAttempts: 0, lockedUntil: 0 },
      appPreferences: { lastBackupAt: null },
      schemaVersion: SCHEMA_VERSION,
      createdAt: ts,
    };
    await ctx.req(ctx.stores.settings.put(settings));
    return settings;
  });
}

export async function updateSettings(patch) {
  return withTx(['settings'], 'readwrite', async (ctx) => {
    const current = await ctx.req(ctx.stores.settings.get(SETTINGS_KEY));
    const next = {
      ...current,
      ...patch,
      securitySettings: { ...(current.securitySettings || {}), ...(patch.securitySettings || {}) },
      appPreferences: { ...(current.appPreferences || {}), ...(patch.appPreferences || {}) },
    };
    await ctx.req(ctx.stores.settings.put(next));
    return next;
  });
}

/* ---------- ATM ---------- */

export async function createAccount(input) {
  return withTx(['accounts', 'activity_logs'], 'readwrite', async (ctx) => {
    const accounts = await all(ctx, 'accounts');
    const v = validateAccount(input, accounts);
    if (!v.ok) throw new ValidationError(v.errors);
    const ts = now();
    const rec = {
      id: newId(),
      ...v.value,
      includeInTotal: input.includeInTotal !== false,
      createdAt: ts,
      updatedAt: ts,
      archivedAt: null,
    };
    await ctx.req(ctx.stores.accounts.put(rec));
    await log(ctx, 'account', rec.id, 'create', null, rec);
    return rec;
  });
}

export async function updateAccount(id, input) {
  return withTx(['accounts', 'activity_logs'], 'readwrite', async (ctx) => {
    const accounts = await all(ctx, 'accounts');
    const old = accounts.find((a) => a.id === id);
    if (!old) throw new Error('ATM tidak ditemukan.');
    const merged = {
      name: input.name ?? old.name,
      initialBalance: input.initialBalance ?? old.initialBalance,
      note: input.note ?? old.note ?? '',
    };
    const v = validateAccount({ id, ...merged }, accounts);
    if (!v.ok) throw new ValidationError(v.errors);
    const next = {
      ...old,
      ...v.value,
      includeInTotal: input.includeInTotal ?? old.includeInTotal ?? true,
      updatedAt: now(),
    };
    await ctx.req(ctx.stores.accounts.put(next));
    await log(ctx, 'account', id, 'update', old, next);
    return next;
  });
}

export async function setAccountArchived(id, archived) {
  return withTx(['accounts', 'activity_logs'], 'readwrite', async (ctx) => {
    const old = await ctx.req(ctx.stores.accounts.get(id));
    if (!old) throw new Error('ATM tidak ditemukan.');
    const next = { ...old, archivedAt: archived ? now() : null, updatedAt: now() };
    await ctx.req(ctx.stores.accounts.put(next));
    await log(ctx, 'account', id, archived ? 'archive' : 'unarchive', old, next);
    return next;
  });
}

/** Hapus ATM hanya jika tidak punya transaksi/transfer terkait (termasuk yang sudah dihapus-lunak). */
export async function deleteAccount(id) {
  return withTx(['accounts', 'transactions', 'transfers', 'activity_logs'], 'readwrite', async (ctx) => {
    const old = await ctx.req(ctx.stores.accounts.get(id));
    if (!old) throw new Error('ATM tidak ditemukan.');
    const txCount = await ctx.req(ctx.stores.transactions.index('accountId').count(id));
    const trCount =
      (await ctx.req(ctx.stores.transfers.index('fromAccountId').count(id))) +
      (await ctx.req(ctx.stores.transfers.index('toAccountId').count(id)));
    if (txCount + trCount > 0) {
      throw new Error('ATM ini memiliki riwayat transaksi. Arsipkan saja agar riwayat tetap aman.');
    }
    await ctx.req(ctx.stores.accounts.delete(id));
    await log(ctx, 'account', id, 'delete', old, null);
  });
}

/* ---------- Kategori ---------- */

export async function createCategory(name, type) {
  return withTx(['categories', 'activity_logs'], 'readwrite', async (ctx) => {
    const categories = await all(ctx, 'categories');
    const v = validateCategory({ name, type }, categories);
    if (!v.ok) throw new ValidationError(v.errors);
    const ts = now();
    const rec = { id: newId(), ...v.value, createdAt: ts, updatedAt: ts };
    await ctx.req(ctx.stores.categories.put(rec));
    await log(ctx, 'category', rec.id, 'create', null, rec);
    return rec;
  });
}

export async function updateCategory(id, name) {
  return withTx(['categories', 'activity_logs'], 'readwrite', async (ctx) => {
    const categories = await all(ctx, 'categories');
    const old = categories.find((c) => c.id === id);
    if (!old) throw new Error('Kategori tidak ditemukan.');
    const v = validateCategory({ id, name, type: old.type }, categories);
    if (!v.ok) throw new ValidationError(v.errors);
    const next = { ...old, name: v.value.name, updatedAt: now() };
    await ctx.req(ctx.stores.categories.put(next));
    await log(ctx, 'category', id, 'update', old, next);
    return next;
  });
}

export async function deleteCategory(id) {
  return withTx(['categories', 'transactions', 'activity_logs'], 'readwrite', async (ctx) => {
    const old = await ctx.req(ctx.stores.categories.get(id));
    if (!old) throw new Error('Kategori tidak ditemukan.');
    const used = await ctx.req(ctx.stores.transactions.index('categoryId').count(id));
    if (used > 0) {
      throw new Error(`Kategori dipakai oleh ${used} transaksi. Ubah kategori transaksi tersebut terlebih dahulu.`);
    }
    await ctx.req(ctx.stores.categories.delete(id));
    await log(ctx, 'category', id, 'delete', old, null);
  });
}

/* ---------- Transaksi pemasukan / pengeluaran ---------- */

export async function createTransaction(input) {
  return withTx(['accounts', 'categories', 'transactions', 'activity_logs'], 'readwrite', async (ctx) => {
    const accounts = await all(ctx, 'accounts');
    const categories = await all(ctx, 'categories');
    const v = validateTransaction(input, { accounts, categories });
    if (!v.ok) throw new ValidationError(v.errors);
    const ts = now();
    const rec = { id: newId(), ...v.value, createdAt: ts, updatedAt: ts, deletedAt: null };
    await ctx.req(ctx.stores.transactions.put(rec));
    await log(ctx, 'transaction', rec.id, 'create', null, rec);
    return rec;
  });
}

export async function updateTransaction(id, input) {
  return withTx(['accounts', 'categories', 'transactions', 'activity_logs'], 'readwrite', async (ctx) => {
    const old = await ctx.req(ctx.stores.transactions.get(id));
    if (!old || old.deletedAt) throw new Error('Transaksi tidak ditemukan.');
    const accounts = await all(ctx, 'accounts');
    const categories = await all(ctx, 'categories');
    const merged = { ...old, ...input };
    const v = validateTransaction(merged, { accounts, categories });
    if (!v.ok) throw new ValidationError(v.errors);
    const next = { ...old, ...v.value, updatedAt: now() };
    await ctx.req(ctx.stores.transactions.put(next));
    await log(ctx, 'transaction', id, 'update', old, next);
    return next;
  });
}

export async function deleteTransaction(id) {
  return withTx(['transactions', 'activity_logs'], 'readwrite', async (ctx) => {
    const old = await ctx.req(ctx.stores.transactions.get(id));
    if (!old || old.deletedAt) throw new Error('Transaksi tidak ditemukan.');
    const next = { ...old, deletedAt: now(), updatedAt: now() };
    await ctx.req(ctx.stores.transactions.put(next));
    await log(ctx, 'transaction', id, 'delete', old, null);
  });
}

/* ---------- Transfer antar-ATM (satu rekaman = dua sisi, tidak bisa terhapus sebagian) ---------- */

export async function createTransfer(input) {
  return withTx(['accounts', 'transfers', 'activity_logs'], 'readwrite', async (ctx) => {
    const accounts = await all(ctx, 'accounts');
    const v = validateTransfer(input, { accounts });
    if (!v.ok) throw new ValidationError(v.errors);
    const ts = now();
    const rec = { id: newId(), ...v.value, createdAt: ts, updatedAt: ts, deletedAt: null };
    await ctx.req(ctx.stores.transfers.put(rec));
    await log(ctx, 'transfer', rec.id, 'create', null, rec);
    return rec;
  });
}

export async function updateTransfer(id, input) {
  return withTx(['accounts', 'transfers', 'activity_logs'], 'readwrite', async (ctx) => {
    const old = await ctx.req(ctx.stores.transfers.get(id));
    if (!old || old.deletedAt) throw new Error('Transfer tidak ditemukan.');
    const accounts = await all(ctx, 'accounts');
    const v = validateTransfer({ ...old, ...input }, { accounts });
    if (!v.ok) throw new ValidationError(v.errors);
    const next = { ...old, ...v.value, updatedAt: now() };
    await ctx.req(ctx.stores.transfers.put(next));
    await log(ctx, 'transfer', id, 'update', old, next);
    return next;
  });
}

export async function deleteTransfer(id) {
  return withTx(['transfers', 'activity_logs'], 'readwrite', async (ctx) => {
    const old = await ctx.req(ctx.stores.transfers.get(id));
    if (!old || old.deletedAt) throw new Error('Transfer tidak ditemukan.');
    const next = { ...old, deletedAt: now(), updatedAt: now() };
    await ctx.req(ctx.stores.transfers.put(next));
    await log(ctx, 'transfer', id, 'delete', old, null);
  });
}

/* ---------- Impor CSV (atomik: semua baris valid masuk, atau tidak sama sekali) ---------- */

/**
 * rows: hasil dari prepareImport().valid, masing-masing berisi field transaksi yang sudah dinormalisasi
 * dan accountId/categoryId yang sudah di-resolve. Kategori yang belum ada dibuat di transaksi yang sama.
 */
export async function importTransactions(rows, { newCategories = [] } = {}) {
  return withTx(['accounts', 'categories', 'transactions', 'activity_logs'], 'readwrite', async (ctx) => {
    const ts = now();
    const created = [];
    for (const c of newCategories) {
      const rec = { id: newId(), name: c.name, type: c.type, createdAt: ts, updatedAt: ts };
      await ctx.req(ctx.stores.categories.put(rec));
      created.push(rec);
    }
    const accounts = await all(ctx, 'accounts');
    const categories = await all(ctx, 'categories');
    let count = 0;
    for (const { categoryName, ...row } of rows) {
      const cat = categories.find(
        (c) => c.type === row.type && c.name.toLowerCase() === String(categoryName || '').toLowerCase(),
      );
      const v = validateTransaction({ ...row, categoryId: cat?.id }, { accounts, categories });
      if (!v.ok) throw new ValidationError(v.errors, 'Ada baris impor yang tidak valid.');
      await ctx.req(ctx.stores.transactions.put({ id: newId(), ...v.value, createdAt: ts, updatedAt: ts, deletedAt: null }));
      count += 1;
    }
    await log(ctx, 'import', 'csv', 'import', null, { transactions: count, categoriesCreated: created.length });
    return { imported: count, categoriesCreated: created.length };
  });
}

/* ---------- Backup & restore ---------- */

/** Susun isi backup. PIN/hash keamanan TIDAK disertakan. */
export async function buildBackupObject() {
  const data = await loadData();
  const settings = await readSettings();
  return {
    app: 'MY FINANCE',
    schemaVersion: SCHEMA_VERSION,
    createdAt: now(),
    settings: {
      theme: settings?.theme || 'light',
      autoLockMinutes: settings?.autoLockMinutes ?? 5,
    },
    data: {
      accounts: data.accounts,
      transactions: data.transactions,
      transfers: data.transfers,
      categories: data.categories,
      activity_logs: data.activity_logs,
    },
  };
}

/** Buat teks backup (opsional terenkripsi) dan catat di log serta tanggal backup terakhir. */
export async function createBackupText({ passphrase = null } = {}) {
  const obj = await buildBackupObject();
  const plain = JSON.stringify(obj, null, 2);
  const text = passphrase ? JSON.stringify(await encryptText(plain, passphrase), null, 2) : plain;
  const ts = now();
  await withTx(['activity_logs'], 'readwrite', async (ctx) => {
    await log(ctx, 'backup', 'database', 'backup', null, { counts: validateBackup(obj).counts, encrypted: !!passphrase });
  });
  await updateSettings({ appPreferences: { lastBackupAt: ts } });
  return { text, counts: validateBackup(obj).counts, encrypted: !!passphrase };
}

/**
 * Restore atomik. Validasi dilakukan sebelum menyentuh database.
 * Di dalam satu transaksi: kosongkan tabel data, isi ulang dari backup.
 * Log aktivitas yang sudah ada dipertahankan (digabung), tidak pernah dihapus.
 */
export async function restoreBackup(obj) {
  const v = validateBackup(obj);
  if (!v.ok) throw new ValidationError({}, v.errors.join(' '));
  const d = obj.data;
  return withTx(['accounts', 'transactions', 'transfers', 'categories', 'activity_logs'], 'readwrite', async (ctx) => {
    const currentLogs = await all(ctx, 'activity_logs');
    await clearStores(ctx, ['accounts', 'transactions', 'transfers', 'categories']);
    for (const a of d.accounts) await ctx.req(ctx.stores.accounts.put(a));
    for (const c of d.categories) await ctx.req(ctx.stores.categories.put(c));
    for (const t of d.transactions) await ctx.req(ctx.stores.transactions.put(t));
    for (const tr of d.transfers) await ctx.req(ctx.stores.transfers.put(tr));
    const have = new Set(currentLogs.map((l) => l.id));
    for (const l of d.activity_logs) {
      if (!have.has(l.id)) await ctx.req(ctx.stores.activity_logs.put(l));
    }
    await log(ctx, 'backup', 'database', 'restore', null, { counts: v.counts });
    return v.counts;
  });
}

/** Reset total (dipakai untuk pemulihan setelah PIN lupa; wajib sudah punya file backup). */
export async function resetEverything() {
  await deleteDatabase();
  localStorage.clear();
}
