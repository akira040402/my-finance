// Lapisan IndexedDB. Tanpa dependensi (pengganti Dexie.js).
// Setiap penulisan dilakukan dalam satu transaksi IndexedDB; jika salah satu langkah gagal,
// seluruh transaksi di-rollback otomatis.

export const DB_NAME = 'my-finance';
export const DB_VERSION = 1;
export const SETTINGS_KEY = 'main';

let dbPromise = null;

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function upgrade(db) {
  if (!db.objectStoreNames.contains('accounts')) {
    const s = db.createObjectStore('accounts', { keyPath: 'id' });
    s.createIndex('archivedAt', 'archivedAt');
  }
  if (!db.objectStoreNames.contains('transactions')) {
    const s = db.createObjectStore('transactions', { keyPath: 'id' });
    s.createIndex('accountId', 'accountId');
    s.createIndex('date', 'date');
    s.createIndex('categoryId', 'categoryId');
    s.createIndex('type', 'type');
  }
  if (!db.objectStoreNames.contains('transfers')) {
    const s = db.createObjectStore('transfers', { keyPath: 'id' });
    s.createIndex('fromAccountId', 'fromAccountId');
    s.createIndex('toAccountId', 'toAccountId');
    s.createIndex('date', 'date');
  }
  if (!db.objectStoreNames.contains('categories')) {
    const s = db.createObjectStore('categories', { keyPath: 'id' });
    s.createIndex('type', 'type');
  }
  if (!db.objectStoreNames.contains('activity_logs')) {
    const s = db.createObjectStore('activity_logs', { keyPath: 'id' });
    s.createIndex('timestamp', 'timestamp');
    s.createIndex('entityId', 'entityId');
  }
  if (!db.objectStoreNames.contains('settings')) {
    db.createObjectStore('settings', { keyPath: 'id' });
  }
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Browser ini tidak mendukung IndexedDB.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database sedang dibuka di tab lain. Tutup tab lain lalu muat ulang.'));
  });
  return dbPromise;
}

/**
 * Jalankan fn dalam satu transaksi.
 * fn menerima objek ctx dengan helper synchronous-style (await req(...) aman di dalam transaksi
 * karena hanya menunggu request IndexedDB).
 */
export async function withTx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map((n) => [n, tx.objectStore(n)]));
    let result;
    let failed = false;
    tx.oncomplete = () => {
      if (!failed) resolve(result);
    };
    tx.onerror = () => {
      failed = true;
      reject(tx.error);
    };
    tx.onabort = () => {
      failed = true;
      reject(tx.error || new Error('Transaksi dibatalkan. Tidak ada data yang berubah.'));
    };
    Promise.resolve()
      .then(() => fn({ stores, tx, req }))
      .then((r) => {
        result = r;
      })
      .catch((err) => {
        failed = true;
        try {
          tx.abort();
        } catch (_) {
          /* transaksi sudah selesai */
        }
        reject(err);
      });
  });
}

export async function readAll(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  return req(tx.objectStore(storeName).getAll());
}

export async function readSettings() {
  const db = await openDB();
  const tx = db.transaction('settings', 'readonly');
  return (await req(tx.objectStore('settings').get(SETTINGS_KEY))) || null;
}

/** Hapus seluruh isi database aplikasi (dipakai saat reset / restore). */
export async function clearStores(ctx, storeNames) {
  for (const name of storeNames) {
    await req(ctx.stores[name].clear());
  }
}

export async function deleteDatabase() {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch (_) {
      /* abaikan */
    }
    dbPromise = null;
  }
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Tutup tab lain yang memakai aplikasi ini, lalu coba lagi.'));
  });
}
