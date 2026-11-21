// Laporan: grafik pemasukan vs pengeluaran, kategori, saldo, perbandingan ATM, bulanan, tahunan.
// Transfer internal TIDAK dihitung sebagai pemasukan/pengeluaran; biaya admin dihitung sebagai pengeluaran.
import {
  computeBalances, summarize, dailySeries, monthlySeries, yearlySeries, periodRange,
} from '../core/ledger.js';
import { formatRupiah } from '../core/money.js';
import { esc, optionList, amt, todayISO } from '../ui/dom.js';
import { barChart, lineChart, hBars } from '../ui/charts.js';

const PERIODS = [
  { value: 'day', label: 'Hari' },
  { value: 'week', label: 'Minggu' },
  { value: 'month', label: 'Bulan' },
  { value: 'year', label: 'Tahun' },
  { value: 'range', label: 'Rentang tanggal' },
];
const CAT_NAME = (id, cats) => {
  if (id === '__fee__') return 'Biaya admin transfer';
  if (id === '__none__') return 'Tanpa kategori';
  return cats.find((c) => c.id === id)?.name || 'Kategori dihapus';
};
const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function readParams(query) {
  const today = todayISO();
  const period = PERIODS.some((p) => p.value === query.get('periode')) ? query.get('periode') : 'month';
  const anchor = isISO(query.get('tgl')) ? query.get('tgl') : today;
  let { from, to } = periodRange(period === 'range' ? 'day' : period, anchor);
  if (period === 'range') {
    from = isISO(query.get('dari')) ? query.get('dari') : `${today.slice(0, 7)}-01`;
    to = isISO(query.get('sampai')) ? query.get('sampai') : today;
    if (from > to) [from, to] = [to, from];
  }
  return { period, anchor, from, to, acc: query.get('acc') || 'all', kat: query.get('kat') || '' };
}

function paramsHash(p) {
  const qs = new URLSearchParams({ periode: p.period, tgl: p.anchor });
  if (p.period === 'range') {
    qs.set('dari', p.from);
    qs.set('sampai', p.to);
  }
  if (p.acc !== 'all') qs.set('acc', p.acc);
  if (p.kat) qs.set('kat', p.kat);
  return `#/laporan?${qs.toString()}`;
}

/** Sampel saldo sepanjang rentang, untuk seluruh ATM atau satu ATM. */
function balanceLine(data, p, accountIds) {
  const days = dailySeries(data, { from: p.from, to: p.to }).map((d) => d.date);
  if (!days.length) return [];
  const step = Math.max(1, Math.ceil(days.length / 60));
  const picks = days.filter((_, i) => i % step === 0);
  if (picks[picks.length - 1] !== days[days.length - 1]) picks.push(days[days.length - 1]);
  return picks.map((date) => {
    const { byAccount, total } = computeBalances(data, { asOf: date });
    const value = accountIds ? accountIds.reduce((n, id) => n + (byAccount.get(id) ?? 0), 0) : total;
    return { label: date.slice(8) + '/' + date.slice(5, 7), value };
  });
}

/** Agregasi harian menjadi bulanan jika rentang panjang. */
function flowSeries(data, p, accountIds) {
  const daily = dailySeries(data, { from: p.from, to: p.to, accountIds });
  const spanDays = daily.length;
  if (spanDays <= 62) {
    return {
      labels: daily.map((d) => d.date.slice(8)),
      income: daily.map((d) => d.income),
      expense: daily.map((d) => d.expense),
      caption: 'per hari',
    };
  }
  const byMonth = new Map();
  for (const d of daily) {
    const k = d.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, { income: 0, expense: 0 });
    byMonth.get(k).income += d.income;
    byMonth.get(k).expense += d.expense;
  }
  const keys = [...byMonth.keys()];
  return {
    labels: keys.map((k) => `${MONTHS3[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`),
    income: keys.map((k) => byMonth.get(k).income),
    expense: keys.map((k) => byMonth.get(k).expense),
    caption: 'per bulan',
  };
}

function render({ data, query }) {
  const p = readParams(query);
  const accountIds = p.acc === 'all' ? null : [p.acc];
  const s = summarize(data, { from: p.from, to: p.to, accountIds, categoryId: p.kat || null });
  const balances = computeBalances(data);
  const totalNow = balances.total;
  const scopedNow = accountIds ? balances.byAccount.get(p.acc) ?? 0 : totalNow;
  const top = s.topCategory;
  const flow = flowSeries(data, p, accountIds);
  const year = Number(p.anchor.slice(0, 4));
  const monthly = monthlySeries(data, year, accountIds);
  const yearly = yearlySeries(data, accountIds);

  const expenseCats = s.categoryTotals.map((c) => ({
    label: CAT_NAME(c.categoryId, data.categories),
    value: c.total,
    color: c.categoryId === '__fee__' ? 'var(--move)' : 'var(--expense)',
  }));

  const perAccount = data.accounts.filter((a) => !a.archivedAt || accountIds === null).map((a) => {
    const sa = summarize(data, { from: p.from, to: p.to, accountIds: [a.id], categoryId: p.kat || null });
    return { name: a.name, income: sa.income, expense: sa.expense };
  }).filter((x) => x.income || x.expense);

  const periodLabel = `${p.from} s.d. ${p.to}`;
  const hasAny = data.transactions.length || data.transfers.length;

  const periodForm = `
    <form class="filters report-form" data-form="report-noop" autocomplete="off">
      <label class="field"><span>Periode</span>
        <select name="periode" data-change="report-auto">${optionList(PERIODS, p.period)}</select></label>
      ${p.period === 'range'
        ? `<label class="field"><span>Dari</span><input type="date" name="dari" value="${esc(p.from)}" data-change="report-auto"></label>
           <label class="field"><span>Sampai</span><input type="date" name="sampai" value="${esc(p.to)}" data-change="report-auto"></label>`
        : `<label class="field"><span>Tanggal acuan</span><input type="date" name="tgl" value="${esc(p.anchor)}" data-change="report-auto"></label>`}
      <label class="field"><span>ATM</span>
        <select name="acc" data-change="report-auto">${optionList([{ value: 'all', label: 'Semua ATM' }, ...data.accounts.map((a) => ({ value: a.id, label: a.name + (a.archivedAt ? ' (diarsipkan)' : '') }))], p.acc)}</select></label>
      <label class="field"><span>Kategori</span>
        <select name="kat" data-change="report-auto">${optionList([{ value: '', label: 'Semua kategori' }, ...data.categories.map((c) => ({ value: c.id, label: c.name + (c.type === 'income' ? ' (masuk)' : '') }))], p.kat)}</select></label>
    </form>`;

  if (!hasAny && data.accounts.length === 0) {
    return `${periodForm}<div class="empty card"><p>Belum ada data. Tambahkan ATM dan transaksi untuk melihat laporan.</p></div>`;
  }

  return `
    ${periodForm}
    <p class="hint">Periode: ${esc(periodLabel)}${accountIds ? ` · ATM: ${esc(data.accounts.find((a) => a.id === p.acc)?.name || '')}` : ''}</p>

    <section class="stats">
      <article class="stat"><span class="stat-label">Total pemasukan</span><strong class="stat-value amt-in">${esc(formatRupiah(s.income))}</strong></article>
      <article class="stat"><span class="stat-label">Total pengeluaran</span><strong class="stat-value amt-out">${esc(formatRupiah(s.expense))}</strong>${s.fees ? `<span class="stat-foot">termasuk biaya admin ${esc(formatRupiah(s.fees))}</span>` : ''}</article>
      <article class="stat"><span class="stat-label">Selisih</span><strong class="stat-value ${s.net >= 0 ? 'amt-in' : 'amt-out'}">${esc(formatRupiah(s.net, { sign: true }))}</strong></article>
      <article class="stat"><span class="stat-label">${accountIds ? 'Saldo ATM terkini' : 'Total saldo'}</span><strong class="stat-value">${esc(formatRupiah(scopedNow))}</strong><span class="stat-foot">${s.transferCount} transfer · ${esc(formatRupiah(s.transferVolume))} dipindah</span></article>
      <article class="stat"><span class="stat-label">Kategori pengeluaran terbesar</span><strong class="stat-value">${top ? esc(CAT_NAME(top.categoryId, data.categories)) : '—'}</strong>${top ? `<span class="stat-foot">${esc(formatRupiah(top.total))}</span>` : ''}</article>
    </section>

    <div class="grid-2">
      <section class="card">
        <header class="card-head"><h2>Pemasukan vs pengeluaran</h2><span class="muted">${flow.caption}</span></header>
        ${barChart({
          labels: flow.labels,
          series: [
            { name: 'Pemasukan', color: 'var(--income)', values: flow.income },
            { name: 'Pengeluaran', color: 'var(--expense)', values: flow.expense },
          ],
          ariaLabel: 'Grafik pemasukan dan pengeluaran',
        })}
      </section>
      <section class="card">
        <header class="card-head"><h2>Pengeluaran per kategori</h2></header>
        ${hBars(expenseCats, { total: s.expense })}
      </section>
    </div>

    <div class="grid-2">
      <section class="card">
        <header class="card-head"><h2>Perkembangan saldo</h2><span class="muted">${accountIds ? 'ATM terpilih' : 'Seluruh ATM ikut total'}</span></header>
        ${lineChart({ points: balanceLine(data, p, accountIds), ariaLabel: 'Grafik perkembangan saldo' })}
      </section>
      <section class="card">
        <header class="card-head"><h2>Perbandingan antar-ATM</h2></header>
        ${accountIds
          ? `<p class="muted">Pilih "Semua ATM" untuk membandingkan antar-ATM.</p>`
          : barChart({
              labels: perAccount.map((x) => x.name),
              series: [
                { name: 'Pemasukan', color: 'var(--income)', values: perAccount.map((x) => x.income) },
                { name: 'Pengeluaran', color: 'var(--expense)', values: perAccount.map((x) => x.expense) },
              ],
              height: 220,
              ariaLabel: 'Perbandingan antar ATM',
            })}
      </section>
    </div>

    <div class="grid-2">
      <section class="card">
        <header class="card-head"><h2>Grafik bulanan ${year}</h2></header>
        ${barChart({
          labels: MONTHS3,
          series: [
            { name: 'Pemasukan', color: 'var(--income)', values: monthly.map((m) => m.income) },
            { name: 'Pengeluaran', color: 'var(--expense)', values: monthly.map((m) => m.expense) },
          ],
          height: 220,
          ariaLabel: 'Grafik bulanan',
        })}
      </section>
      <section class="card">
        <header class="card-head"><h2>Grafik tahunan</h2></header>
        ${barChart({
          labels: yearly.map((y) => y.year),
          series: [
            { name: 'Pemasukan', color: 'var(--income)', values: yearly.map((y) => y.income) },
            { name: 'Pengeluaran', color: 'var(--expense)', values: yearly.map((y) => y.expense) },
          ],
          height: 220,
          ariaLabel: 'Grafik tahunan',
        })}
      </section>
    </div>
    <p class="hint center">Total saldo seluruh ATM saat ini: ${amt(totalNow, 'neutral')}. Transfer internal tidak dihitung sebagai pemasukan atau pengeluaran.</p>`;
}

const changes = {
  'report-auto': (el) => {
    const form = el.form;
    const fd = new FormData(form);
    const p = {
      period: String(fd.get('periode') || 'month'),
      anchor: String(fd.get('tgl') || todayISO()),
      from: String(fd.get('dari') || ''),
      to: String(fd.get('sampai') || ''),
      acc: String(fd.get('acc') || 'all'),
      kat: String(fd.get('kat') || ''),
    };
    const range = p.period === 'range';
    location.hash = paramsHash({
      ...p,
      anchor: isISO(p.anchor) ? p.anchor : todayISO(),
      from: range ? p.from : '',
      to: range ? p.to : '',
    });
  },
};

export default {
  title: () => 'Laporan',
  render,
  actions: {},
  forms: { 'report-noop': () => {} },
  changes,
};
