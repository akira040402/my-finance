// Uji otomatis untuk perhitungan saldo, transfer, validasi, CSV, dan backup.
// Jalankan: npm test   (atau: node --test tests/)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBalances, summarize, filterRows, toRows, periodRange, reconcile, monthlySeries, TYPE,
} from '../js/core/ledger.js';
import { validateTransaction, validateTransfer, validateAccount, validateBackup } from '../js/core/validate.js';
import { parseCSV, toCSV, guessMapping } from '../js/core/csv.js';
import { prepareImport } from '../js/core/importer.js';
import { parseRupiah, formatRupiah, normalizeDateInput } from '../js/core/money.js';
import { lockoutDelayMs, validatePinFormat } from '../js/core/security.js';

// Data uji (hanya di dalam file tes, bukan data permanen aplikasi).
const base = () => ({
  accounts: [
    { id: 'A', name: 'ATM A', initialBalance: 1_000_000, archivedAt: null },
    { id: 'B', name: 'ATM B', initialBalance: 200_000, archivedAt: null },
  ],
  categories: [
    { id: 'c-food', name: 'Makanan', type: 'expense' },
    { id: 'c-salary', name: 'Gaji', type: 'income' },
  ],
  transactions: [],
  transfers: [],
  activity_logs: [],
});

describe('saldo ATM', () => {
  test('saldo awal saja', () => {
    const d = base();
    const { byAccount, total } = computeBalances(d);
    assert.equal(byAccount.get('A'), 1_000_000);
    assert.equal(byAccount.get('B'), 200_000);
    assert.equal(total, 1_200_000);
  });

  test('pemasukan dan pengeluaran mengubah saldo ATM dan total', () => {
    const d = base();
    d.transactions.push(
      { id: 't1', accountId: 'A', type: TYPE.INCOME, amount: 500_000, date: '2026-11-01', categoryId: 'c-salary' },
      { id: 't2', accountId: 'A', type: TYPE.EXPENSE, amount: 150_000, date: '2026-11-02', categoryId: 'c-food' },
    );
    const { byAccount, total } = computeBalances(d);
    assert.equal(byAccount.get('A'), 1_350_000);
    assert.equal(total, 1_550_000);
  });

  test('transaksi yang dihapus-lunak tidak dihitung', () => {
    const d = base();
    d.transactions.push({ id: 't1', accountId: 'A', type: TYPE.EXPENSE, amount: 300_000, date: '2026-11-01', deletedAt: '2026-11-03T00:00:00Z' });
    assert.equal(computeBalances(d).total, 1_200_000);
  });

  test('ATM diarsipkan tidak masuk total', () => {
    const d = base();
    d.accounts[1].archivedAt = '2026-11-01T00:00:00Z';
    assert.equal(computeBalances(d).total, 1_000_000);
  });

  test('ATM dengan includeInTotal=false tidak masuk total tetapi saldonya tetap ada', () => {
    const d = base();
    d.accounts[1].includeInTotal = false;
    const { byAccount, total } = computeBalances(d);
    assert.equal(byAccount.get('B'), 200_000);
    assert.equal(total, 1_000_000);
  });

  test('asOf membatasi perhitungan sampai tanggal tertentu', () => {
    const d = base();
    d.transactions.push(
      { id: 't1', accountId: 'A', type: TYPE.INCOME, amount: 100_000, date: '2026-11-01' },
      { id: 't2', accountId: 'A', type: TYPE.INCOME, amount: 100_000, date: '2026-11-10' },
    );
    assert.equal(computeBalances(d, { asOf: '2026-11-05' }).total, 1_300_000);
  });
});

describe('transfer antar-ATM', () => {
  test('ATM A kirim 500.000 ke ATM B: A berkurang, B bertambah, total tetap', () => {
    const d = base();
    const before = computeBalances(d).total;
    d.transfers.push({ id: 'tr1', fromAccountId: 'A', toAccountId: 'B', amount: 500_000, fee: 0, date: '2026-11-03' });
    const { byAccount, total } = computeBalances(d);
    assert.equal(byAccount.get('A'), 500_000);
    assert.equal(byAccount.get('B'), 700_000);
    assert.equal(total, before);
  });

  test('biaya admin mengurangi total tepat sebesar biaya', () => {
    const d = base();
    d.transfers.push({ id: 'tr1', fromAccountId: 'A', toAccountId: 'B', amount: 500_000, fee: 6_500, date: '2026-11-03' });
    const { byAccount, total } = computeBalances(d);
    assert.equal(byAccount.get('A'), 493_500);
    assert.equal(byAccount.get('B'), 700_000);
    assert.equal(total, 1_200_000 - 6_500);
  });

  test('transfer tidak masuk pemasukan atau pengeluaran laporan (kecuali biaya admin)', () => {
    const d = base();
    d.transfers.push({ id: 'tr1', fromAccountId: 'A', toAccountId: 'B', amount: 500_000, fee: 6_500, date: '2026-11-03' });
    const s = summarize(d, { from: '2026-11-01', to: '2026-11-30' });
    assert.equal(s.income, 0);
    assert.equal(s.expense, 6_500, 'hanya biaya admin yang menjadi pengeluaran');
    assert.equal(s.transferCount, 1);
    assert.equal(s.transferVolume, 500_000);
  });

  test('transfer dihapus-lunak: saldo kembali seperti semula', () => {
    const d = base();
    d.transfers.push({ id: 'tr1', fromAccountId: 'A', toAccountId: 'B', amount: 500_000, fee: 6_500, date: '2026-11-03', deletedAt: 'x' });
    assert.equal(computeBalances(d).total, 1_200_000);
    assert.equal(computeBalances(d).byAccount.get('A'), 1_000_000);
  });

  test('validasi menolak transfer ke ATM yang sama', () => {
    const r = validateTransfer({ fromAccountId: 'A', toAccountId: 'A', amount: '1000', date: '2026-11-01', time: '10:00' }, base());
    assert.equal(r.ok, false);
    assert.ok(r.errors.toAccountId);
  });

  test('validasi menolak transfer ke ATM yang diarsipkan', () => {
    const d = base();
    d.accounts[1].archivedAt = 'x';
    const r = validateTransfer({ fromAccountId: 'A', toAccountId: 'B', amount: '1000', date: '2026-11-01', time: '10:00' }, d);
    assert.equal(r.ok, false);
    assert.ok(r.errors.toAccountId);
  });

  test('riwayat menampilkan transfer sebagai satu baris', () => {
    const d = base();
    d.transfers.push({ id: 'tr1', fromAccountId: 'A', toAccountId: 'B', amount: 500_000, fee: 0, date: '2026-11-03', time: '09:00' });
    const rows = toRows(d);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, TYPE.TRANSFER);
  });
});

describe('rekonsiliasi', () => {
  test('invarian total terpenuhi untuk kombinasi transaksi, transfer, dan arsip', () => {
    const d = base();
    d.accounts.push({ id: 'C', name: 'ATM C', initialBalance: 50_000, archivedAt: 'x' });
    d.transactions.push(
      { id: 't1', accountId: 'A', type: TYPE.INCOME, amount: 100_000, date: '2026-11-01' },
      { id: 't2', accountId: 'B', type: TYPE.EXPENSE, amount: 30_000, date: '2026-11-02' },
    );
    d.transfers.push(
      { id: 'tr1', fromAccountId: 'A', toAccountId: 'B', amount: 200_000, fee: 2_500, date: '2026-11-03' },
      { id: 'tr2', fromAccountId: 'B', toAccountId: 'C', amount: 10_000, fee: 1_000, date: '2026-11-04' },
    );
    const r = reconcile(d);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});

describe('filter, periode, dan deret bulanan', () => {
  test('filter jenis dan pencarian keterangan', () => {
    const d = base();
    d.transactions.push(
      { id: 't1', accountId: 'A', type: TYPE.EXPENSE, amount: 1000, date: '2026-11-01', time: '08:00', description: 'Nasi goreng', categoryId: 'c-food' },
      { id: 't2', accountId: 'A', type: TYPE.INCOME, amount: 1000, date: '2026-11-01', time: '09:00', description: 'Gaji' },
    );
    const rows = filterRows(toRows(d), { kind: TYPE.EXPENSE });
    assert.equal(rows.length, 1);
    assert.equal(filterRows(toRows(d), { search: 'nasi' }).length, 1);
  });

  test('periode minggu dimulai Senin', () => {
    // 2026-11-21 adalah Sabtu -> minggu Senin 2026-11-16 s.d. Minggu 2026-11-22
    assert.deepEqual(periodRange('week', '2026-11-21'), { from: '2026-11-16', to: '2026-11-22' });
  });

  test('periode bulan termasuk akhir bulan yang benar (Februari kabisat)', () => {
    assert.deepEqual(periodRange('month', '2028-02-10'), { from: '2028-02-01', to: '2028-02-29' });
  });

  test('deret bulanan tidak menghitung transfer kecuali biaya admin', () => {
    const d = base();
    d.transfers.push({ id: 'tr1', fromAccountId: 'A', toAccountId: 'B', amount: 500_000, fee: 5_000, date: '2026-03-05' });
    const m = monthlySeries(d, 2026);
    assert.equal(m[2].income, 0);
    assert.equal(m[2].expense, 5_000);
  });
});

describe('validasi input', () => {
  test('transaksi valid lolos dan nominal dinormalisasi ke integer', () => {
    const r = validateTransaction(
      { type: 'expense', accountId: 'A', amount: '1.500.000', date: '2026-11-01', time: '10:30', categoryId: 'c-food' },
      base(),
    );
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.value.amount, 1_500_000);
  });

  test('kategori pemasukan tidak boleh dipakai untuk pengeluaran', () => {
    const r = validateTransaction(
      { type: 'expense', accountId: 'A', amount: 1000, date: '2026-11-01', time: '10:30', categoryId: 'c-salary' },
      base(),
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.categoryId);
  });

  test('nominal nol atau negatif ditolak', () => {
    const r = validateTransaction({ type: 'income', accountId: 'A', amount: '0', date: '2026-11-01', time: '10:30', categoryId: 'c-salary' }, base());
    assert.equal(r.ok, false);
    assert.ok(r.errors.amount);
  });

  test('ATM duplikat (nama sama, tidak case-sensitive) ditolak', () => {
    const r = validateAccount({ name: 'atm a' }, base().accounts);
    assert.equal(r.ok, false);
  });

  test('parseRupiah membuang pemisah ribuan', () => {
    assert.equal(parseRupiah('1.250.000'), 1_250_000);
    assert.equal(parseRupiah('Rp 75.000'), 75_000);
    assert.ok(Number.isNaN(parseRupiah('')));
  });

  test('formatRupiah tidak memakai angka desimal', () => {
    assert.equal(formatRupiah(1500000).replace(/\s/g, ' ').includes('1.500.000'), true);
  });

  test('tanggal dd/mm/yyyy dinormalisasi ke ISO, tanggal mustahil ditolak', () => {
    assert.equal(normalizeDateInput('05/11/2026'), '2026-11-05');
    assert.equal(normalizeDateInput('31/02/2026'), null);
  });

  test('PIN harus 4-8 digit angka', () => {
    assert.ok(validatePinFormat('12'));
    assert.ok(validatePinFormat('12a4'));
    assert.equal(validatePinFormat('1234'), null);
  });

  test('jeda setelah percobaan PIN salah bertambah', () => {
    assert.equal(lockoutDelayMs(2), 0);
    assert.equal(lockoutDelayMs(3), 30_000);
    assert.equal(lockoutDelayMs(4), 60_000);
    assert.equal(lockoutDelayMs(50), 15 * 60_000);
  });
});

describe('CSV', () => {
  test('parse dengan tanda kutip, koma di dalam kolom, dan baris kosong', () => {
    const text = 'tanggal,atm,nominal,keterangan\r\n2026-11-01,ATM A,1000,"Makan, siang"\r\n\r\n2026-11-02,ATM B,2000,"Dia bilang ""halo"""\r\n';
    const { headers, rows } = parseCSV(text);
    assert.deepEqual(headers, ['tanggal', 'atm', 'nominal', 'keterangan']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].keterangan, 'Makan, siang');
    assert.equal(rows[1].keterangan, 'Dia bilang "halo"');
  });

  test('pemisah titik-koma terdeteksi', () => {
    const { rows } = parseCSV('tanggal;atm;nominal\n2026-11-01;ATM A;1000\n');
    assert.equal(rows[0].nominal, '1000');
  });

  test('tanda kutip tidak tertutup menghasilkan error', () => {
    assert.throws(() => parseCSV('a,b\n"x,y\n'));
  });

  test('tulis lalu baca ulang menghasilkan data yang sama', () => {
    const recs = [{ a: 'satu, dua', b: 'kutip "x"', c: 5 }];
    const { rows } = parseCSV(toCSV(recs, [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }, { key: 'c', label: 'c' }]));
    assert.equal(rows[0].a, 'satu, dua');
    assert.equal(rows[0].b, 'kutip "x"');
    assert.equal(rows[0].c, '5');
  });

  test('tebakan pemetaan kolom untuk header Indonesia', () => {
    const map = guessMapping(['Tanggal', 'Jenis', 'ATM', 'Nominal', 'Kategori', 'Keterangan']);
    assert.equal(map.date, 'Tanggal');
    assert.equal(map.account, 'ATM');
    assert.equal(map.amount, 'Nominal');
  });
});

describe('impor CSV', () => {
  const data = () => ({
    ...base(),
    transactions: [
      { id: 'old', accountId: 'A', type: 'expense', amount: 15000, date: '2026-11-01', time: '08:00', description: 'Kopi', deletedAt: null },
    ],
  });
  const mapping = { date: 'tanggal', time: 'jam', type: 'jenis', account: 'atm', amount: 'nominal', category: 'kategori', description: 'keterangan', source: '', purpose: '' };

  test('baris valid, tidak valid, dan duplikat dipisah dengan benar', () => {
    const csv = [
      'tanggal,jam,jenis,atm,nominal,kategori,keterangan',
      '2026-11-01,08:00,pengeluaran,ATM A,15000,Makanan,Kopi', // duplikat
      '2026-11-02,09:00,pengeluaran,ATM A,20000,Makanan,Nasi', // valid
      '2026-11-03,09:00,pengeluaran,ATM Z,20000,Makanan,Salah ATM', // ATM tidak ada
      '2026-11-04,09:00,pengeluaran,ATM A,15000.50,Makanan,Desimal ambigu', // desimal
      '2026-11-05,09:00,masuk,ATM B,500000,Gaji,Gaji baru', // valid, kategori Gaji ada
      '2026-11-06,09:00,pengeluaran,ATM B,10000,Hiburan,Bioskop', // valid, kategori baru
    ].join('\n');
    const res = prepareImport(parseCSV(csv), mapping, data());
    assert.equal(res.counts.valid, 3);
    assert.equal(res.counts.invalid, 2);
    assert.equal(res.counts.duplicates, 1);
    assert.deepEqual(res.newCategories, [{ name: 'Hiburan', type: 'expense' }]);
  });

  test('jenis pemasukan dikenali dari alias "masuk"', () => {
    const res = prepareImport(parseCSV('tanggal,jenis,atm,nominal\n2026-11-05,masuk,ATM A,1000\n'), { date: 'tanggal', type: 'jenis', account: 'atm', amount: 'nominal', time: '', category: '', description: '', source: '', purpose: '' }, data());
    assert.equal(res.valid[0].row.type, 'income');
  });
});

describe('validasi backup', () => {
  const good = () => ({
    app: 'MY FINANCE',
    schemaVersion: 1,
    data: {
      accounts: [{ id: 'A', name: 'ATM A', initialBalance: 0 }],
      categories: [{ id: 'c1', name: 'Makanan', type: 'expense' }],
      transactions: [{ id: 't1', accountId: 'A', type: 'expense', amount: 1000, date: '2026-11-01', categoryId: 'c1' }],
      transfers: [],
      activity_logs: [],
    },
  });

  test('backup yang benar lolos dan menghitung jumlah data', () => {
    const r = validateBackup(good());
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(r.counts.transactions, 1);
  });

  test('ATM yang tidak ada pada transaksi ditolak', () => {
    const b = good();
    b.data.transactions[0].accountId = 'X';
    assert.equal(validateBackup(b).ok, false);
  });

  test('nominal desimal ditolak', () => {
    const b = good();
    b.data.transactions[0].amount = 1000.5;
    assert.equal(validateBackup(b).ok, false);
  });

  test('versi skema lebih baru ditolak', () => {
    const b = good();
    b.schemaVersion = 99;
    assert.equal(validateBackup(b).ok, false);
  });

  test('file dari aplikasi lain ditolak', () => {
    const b = good();
    b.app = 'LAIN';
    assert.equal(validateBackup(b).ok, false);
  });

  test('ID ganda ditolak', () => {
    const b = good();
    b.data.accounts.push({ id: 'A', name: 'Duplikat', initialBalance: 0 });
    assert.equal(validateBackup(b).ok, false);
  });
});
