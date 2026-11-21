// Logika keuangan murni (tanpa DOM / IndexedDB).
// Sumber kebenaran: accounts, transactions, transfers. Saldo SELALU dihitung ulang dari sini.
//
// Rumus saldo ATM:
//   saldo awal
//   + pemasukan aktif
//   - pengeluaran aktif
//   + transfer masuk aktif
//   - transfer keluar aktif
//   - biaya admin transfer aktif (dari ATM asal)
//
// Transfer TIDAK dihitung sebagai pemasukan/pengeluaran. Biaya admin dihitung sebagai pengeluaran laporan.

export const TYPE = Object.freeze({ INCOME: 'income', EXPENSE: 'expense', TRANSFER: 'transfer' });

const isActive = (r) => !r.deletedAt;
const onOrBefore = (date, asOf) => !asOf || date <= asOf;
const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);

/** Akun yang ikut total saldo: belum diarsipkan dan diizinkan ikut total. */
export function isCountedInTotal(account) {
  return !account.archivedAt && account.includeInTotal !== false;
}

/**
 * Hitung saldo setiap akun.
 * @param {object} data { accounts, transactions, transfers }
 * @param {object} [opts] { asOf: 'YYYY-MM-DD' } - hanya memperhitungkan entri sampai tanggal tsb.
 * @returns {{ byAccount: Map<string, number>, total: number }}
 */
export function computeBalances(data, { asOf = null } = {}) {
  const byAccount = new Map();
  for (const acc of data.accounts) {
    byAccount.set(acc.id, Math.round(acc.initialBalance) || 0);
  }
  for (const t of data.transactions) {
    if (!isActive(t) || !onOrBefore(t.date, asOf) || !byAccount.has(t.accountId)) continue;
    const delta = t.type === TYPE.INCOME ? t.amount : -t.amount;
    byAccount.set(t.accountId, byAccount.get(t.accountId) + delta);
  }
  for (const tr of data.transfers) {
    if (!isActive(tr) || !onOrBefore(tr.date, asOf)) continue;
    if (byAccount.has(tr.fromAccountId)) {
      byAccount.set(tr.fromAccountId, byAccount.get(tr.fromAccountId) - tr.amount - (tr.fee || 0));
    }
    if (byAccount.has(tr.toAccountId)) {
      byAccount.set(tr.toAccountId, byAccount.get(tr.toAccountId) + tr.amount);
    }
  }
  let total = 0;
  for (const acc of data.accounts) {
    if (isCountedInTotal(acc)) total += byAccount.get(acc.id);
  }
  return { byAccount, total };
}

/** Semua baris transaksi dan transfer dalam bentuk satu daftar seragam, terurut terbaru dulu. */
export function toRows(data) {
  const rows = [];
  for (const t of data.transactions) {
    if (!isActive(t)) continue;
    rows.push({
      kind: t.type,
      id: t.id,
      date: t.date,
      time: t.time || '00:00',
      accountId: t.accountId,
      toAccountId: null,
      amount: t.amount,
      fee: 0,
      categoryId: t.categoryId || null,
      description: t.description || '',
      source: t.source || '',
      purpose: t.purpose || '',
    });
  }
  for (const tr of data.transfers) {
    if (!isActive(tr)) continue;
    rows.push({
      kind: TYPE.TRANSFER,
      id: tr.id,
      date: tr.date,
      time: tr.time || '00:00',
      accountId: tr.fromAccountId,
      toAccountId: tr.toAccountId,
      amount: tr.amount,
      fee: tr.fee || 0,
      categoryId: null,
      description: tr.description || '',
      source: '',
      purpose: '',
    });
  }
  rows.sort((a, b) => (a.date === b.date ? (a.time < b.time ? 1 : a.time > b.time ? -1 : 0) : a.date < b.date ? 1 : -1));
  return rows;
}

/**
 * Filter baris riwayat.
 * f.kind: 'all' | 'income' | 'expense' | 'transfer'
 * f.accountId: id akun (transfer cocok jika akun asal atau tujuan)
 * f.categoryId: id kategori (hanya pemasukan/pengeluaran)
 * f.search: teks bebas pada keterangan/sumber/keperluan
 */
export function filterRows(rows, f = {}) {
  const q = (f.search || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.from && r.date < f.from) return false;
    if (f.to && r.date > f.to) return false;
    if (f.kind && f.kind !== 'all' && r.kind !== f.kind) return false;
    if (f.accountId && f.accountId !== 'all') {
      if (r.accountId !== f.accountId && r.toAccountId !== f.accountId) return false;
    }
    if (f.categoryId && r.categoryId !== f.categoryId) return false;
    if (q) {
      const hay = `${r.description} ${r.source} ${r.purpose}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Ringkasan periode. Transfer tidak ikut pemasukan/pengeluaran.
 * accountIds (opsional) membatasi perhitungan pada ATM tertentu.
 */
export function summarize(data, { from = null, to = null, accountIds = null, categoryId = null } = {}) {
  const inScope = (id) => !accountIds || accountIds.includes(id);
  let income = 0;
  let expense = 0;
  let fees = 0;
  let transferCount = 0;
  let transferVolume = 0;
  const byCategory = new Map();

  for (const t of data.transactions) {
    if (!isActive(t) || !inRange(t.date, from, to) || !inScope(t.accountId)) continue;
    if (categoryId && t.categoryId !== categoryId) continue;
    if (t.type === TYPE.INCOME) {
      income += t.amount;
    } else {
      expense += t.amount;
      const key = t.categoryId || '__none__';
      byCategory.set(key, (byCategory.get(key) || 0) + t.amount);
    }
  }
  for (const tr of data.transfers) {
    if (!isActive(tr) || !inRange(tr.date, from, to)) continue;
    if (accountIds && !(inScope(tr.fromAccountId) || inScope(tr.toAccountId))) continue;
    if (categoryId) continue; // transfer tidak punya kategori
    transferCount += 1;
    transferVolume += tr.amount;
    if (tr.fee && inScope(tr.fromAccountId)) {
      fees += tr.fee;
    }
  }
  expense += fees;
  if (fees) byCategory.set('__fee__', (byCategory.get('__fee__') || 0) + fees);

  const categoryTotals = [...byCategory.entries()]
    .map(([id, total]) => ({ categoryId: id, total }))
    .sort((a, b) => b.total - a.total);
  const top = categoryTotals[0] || null;

  return {
    income,
    expense,
    net: income - expense,
    fees,
    transferCount,
    transferVolume,
    categoryTotals,
    topCategory: top,
  };
}

/** Rentang tanggal untuk periode: 'day' | 'week' (Senin-Minggu) | 'month' | 'year'. */
export function periodRange(period, anchorISO) {
  const [y, m, d] = anchorISO.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  if (period === 'day') return { from: anchorISO, to: anchorISO };
  if (period === 'week') {
    const dt = new Date(y, m - 1, d);
    const offsetToMonday = (dt.getDay() + 6) % 7;
    const start = new Date(y, m - 1, d - offsetToMonday);
    const end = new Date(y, m - 1, d - offsetToMonday + 6);
    return { from: iso(start), to: iso(end) };
  }
  if (period === 'month') {
    const last = new Date(y, m, 0).getDate();
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
  }
  if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: null, to: null };
}

/** Deret harian pemasukan & pengeluaran (transfer tidak ikut). */
export function dailySeries(data, { from, to, accountIds = null }) {
  const map = new Map();
  const start = new Date(...from.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  const end = new Date(...to.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  const pad = (n) => String(n).padStart(2, '0');
  for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
    const key = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    map.set(key, { date: key, income: 0, expense: 0 });
  }
  for (const t of data.transactions) {
    if (!isActive(t) || !map.has(t.date)) continue;
    if (accountIds && !accountIds.includes(t.accountId)) continue;
    const row = map.get(t.date);
    if (t.type === TYPE.INCOME) row.income += t.amount;
    else row.expense += t.amount;
  }
  for (const tr of data.transfers) {
    if (!isActive(tr) || !map.has(tr.date) || !tr.fee) continue;
    if (accountIds && !accountIds.includes(tr.fromAccountId)) continue;
    map.get(tr.date).expense += tr.fee;
  }
  return [...map.values()];
}

/** Pemasukan & pengeluaran per bulan untuk satu tahun. */
export function monthlySeries(data, year, accountIds = null) {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: 0, expense: 0 }));
  const add = (date, field, amount, inScope) => {
    if (!date.startsWith(`${year}-`) || !inScope) return;
    const m = Number(date.slice(5, 7)) - 1;
    months[m][field] += amount;
  };
  for (const t of data.transactions) {
    if (!isActive(t)) continue;
    const scope = !accountIds || accountIds.includes(t.accountId);
    add(t.date, t.type === TYPE.INCOME ? 'income' : 'expense', t.amount, scope);
  }
  for (const tr of data.transfers) {
    if (!isActive(tr) || !tr.fee) continue;
    add(tr.date, 'expense', tr.fee, !accountIds || accountIds.includes(tr.fromAccountId));
  }
  return months;
}

/** Ringkasan per tahun (untuk grafik tahunan). */
export function yearlySeries(data, accountIds = null) {
  const years = new Map();
  const bump = (date, field, amount) => {
    const y = date.slice(0, 4);
    if (!years.has(y)) years.set(y, { year: y, income: 0, expense: 0 });
    years.get(y)[field] += amount;
  };
  for (const t of data.transactions) {
    if (!isActive(t)) continue;
    if (accountIds && !accountIds.includes(t.accountId)) continue;
    bump(t.date, t.type === TYPE.INCOME ? 'income' : 'expense', t.amount);
  }
  for (const tr of data.transfers) {
    if (!isActive(tr) || !tr.fee) continue;
    if (accountIds && !accountIds.includes(tr.fromAccountId)) continue;
    bump(tr.date, 'expense', tr.fee);
  }
  return [...years.values()].sort((a, b) => a.year.localeCompare(b.year));
}

/** Titik-titik saldo total sepanjang rentang (dibatasi jumlah titik agar ringan). */
export function balanceSeries(data, { from, to, maxPoints = 60 }) {
  const days = dailySeries(data, { from, to }).map((d) => d.date);
  if (days.length === 0) return [];
  const step = Math.max(1, Math.ceil(days.length / maxPoints));
  const points = [];
  for (let i = 0; i < days.length; i += step) points.push(days[i]);
  if (points[points.length - 1] !== days[days.length - 1]) points.push(days[days.length - 1]);
  return points.map((date) => ({ date, total: computeBalances(data, { asOf: date }).total }));
}

/** Penanda kalender: jumlah transaksi per tanggal dalam satu bulan. */
export function calendarMarks(data, year, month1, accountId = null) {
  const prefix = `${year}-${String(month1).padStart(2, '0')}-`;
  const marks = new Map();
  const mark = (date, kind) => {
    if (!date.startsWith(prefix)) return;
    if (!marks.has(date)) marks.set(date, { count: 0, income: 0, expense: 0, transfer: 0 });
    marks.get(date).count += 1;
    marks.get(date)[kind] += 1;
  };
  for (const r of toRows(data)) {
    if (accountId && r.accountId !== accountId && r.toAccountId !== accountId) continue;
    mark(r.date, r.kind === TYPE.INCOME ? 'income' : r.kind === TYPE.EXPENSE ? 'expense' : 'transfer');
  }
  return marks;
}

/** Detail satu hari: semua baris + total pemasukan, pengeluaran, dan transfer. */
export function dayDetail(data, isoDate) {
  const rows = toRows(data).filter((r) => r.date === isoDate);
  rows.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  let income = 0;
  let expense = 0;
  let transfer = 0;
  for (const r of rows) {
    if (r.kind === TYPE.INCOME) income += r.amount;
    else if (r.kind === TYPE.EXPENSE) expense += r.amount;
    else transfer += r.amount;
  }
  return { rows, income, expense, transfer };
}

/** Hitung ulang saldo tanpa transaksi yang sudah dihapus — dipakai untuk rekonsiliasi. */
export function reconcile(data) {
  const live = computeBalances(data);
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const counted = (id) => byId.has(id) && isCountedInTotal(byId.get(id));
  // Total hanya berubah oleh: pemasukan/pengeluaran dari akun terhitung, transfer ke/dari luar
  // cakupan total (akun diarsipkan), dan biaya admin dari akun terhitung.
  let expectedDelta = 0;
  for (const t of data.transactions) {
    if (!isActive(t) || !counted(t.accountId)) continue;
    expectedDelta += t.type === TYPE.INCOME ? t.amount : -t.amount;
  }
  for (const tr of data.transfers) {
    if (!isActive(tr)) continue;
    const fromCounted = counted(tr.fromAccountId);
    const toCounted = counted(tr.toAccountId);
    if (fromCounted) expectedDelta -= tr.fee || 0;
    if (fromCounted && !toCounted) expectedDelta -= tr.amount;
    if (!fromCounted && toCounted) expectedDelta += tr.amount;
  }
  const initial = data.accounts
    .filter(isCountedInTotal)
    .reduce((s, a) => s + (Math.round(a.initialBalance) || 0), 0);
  const expectedTotal = initial + expectedDelta;
  return { total: live.total, expectedTotal, ok: live.total === expectedTotal };
}
