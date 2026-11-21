// Riwayat: Tahun > Bulan > Kalender > Tanggal > Detail transaksi, dengan filter dan pencarian.
// Posisi riwayat ditentukan oleh tanggal transaksi (bukan tanggal input).
import { toRows, filterRows } from '../core/ledger.js';
import { monthNameID, dayNameID, formatDateLong, daysInMonth, toISODate } from '../core/money.js';
import { esc, icon, optionList, amt } from '../ui/dom.js';
import { rowHTML } from '../ui/rows.js';

const WEEK = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const KINDS = [
  { value: 'all', label: 'Semua jenis' },
  { value: 'income', label: 'Pemasukan' },
  { value: 'expense', label: 'Pengeluaran' },
  { value: 'transfer', label: 'Transfer' },
];

/** Bentuk hash riwayat dari parameter; nilai default tidak ditulis ke URL. */
function hash(p) {
  const qs = new URLSearchParams();
  const put = (k, v) => {
    if (v !== '' && v != null && v !== 'all') qs.set(k, String(v));
  };
  put('y', p.year);
  put('m', p.month);
  put('d', p.day);
  put('acc', p.acc);
  put('jenis', p.kind);
  put('kat', p.cat);
  put('q', p.q);
  const s = qs.toString();
  return `#/riwayat${s ? `?${s}` : ''}`;
}

function readParams(query) {
  const now = new Date();
  const day = query.get('d') || '';
  return {
    year: Number(query.get('y')) || now.getFullYear(),
    month: Math.min(12, Math.max(1, Number(query.get('m')) || now.getMonth() + 1)),
    day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '',
    acc: query.get('acc') || 'all',
    kind: query.get('jenis') || 'all',
    cat: query.get('kat') || '',
    q: query.get('q') || '',
  };
}

function yearsWithData(data) {
  const years = new Set([new Date().getFullYear()]);
  for (const t of [...data.transactions, ...data.transfers]) years.add(Number(t.date.slice(0, 4)));
  return [...years].sort((a, b) => a - b);
}

function render({ data, query }) {
  const p = readParams(query);
  const mm = String(p.month).padStart(2, '0');
  const from = `${p.year}-${mm}-01`;
  const to = `${p.year}-${mm}-${String(daysInMonth(p.year, p.month - 1)).padStart(2, '0')}`;
  const allRows = toRows(data);

  const monthRows = filterRows(allRows, { from, to, accountId: p.acc, kind: p.kind, categoryId: p.cat, search: p.q });

  // Penanda per tanggal (sesuai filter aktif)
  const byDate = new Map();
  for (const r of monthRows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { count: 0, income: 0, expense: 0, transfer: 0 });
    const m = byDate.get(r.date);
    m.count += 1;
    m[r.kind] += 1;
  }

  // Tahun & bulan (jumlah transaksi per bulan tanpa filter ATM/jenis agar navigasi stabil)
  const yearChips = yearsWithData(data)
    .map((y) => `<a class="chip ${y === p.year ? 'active' : ''}" href="${hash({ ...p, year: y, day: '' })}">${y}</a>`)
    .join('');
  const countByMonth = new Array(13).fill(0);
  for (const r of allRows) {
    if (r.date.startsWith(`${p.year}-`)) countByMonth[Number(r.date.slice(5, 7))] += 1;
  }
  const monthChips = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((m) => `<a class="month-chip ${m === p.month ? 'active' : ''}" href="${hash({ ...p, month: m, day: '' })}">
        <span>${monthNameID(m - 1).slice(0, 3)}</span><small>${countByMonth[m] ? `${countByMonth[m]} trx` : '—'}</small></a>`)
    .join('');

  // Kalender Senin–Minggu
  const offset = (new Date(p.year, p.month - 1, 1).getDay() + 6) % 7;
  const today = toISODate();
  const cells = Array.from({ length: offset }, () => '<span class="day empty"></span>');
  for (let d = 1; d <= daysInMonth(p.year, p.month - 1); d++) {
    const iso = `${p.year}-${mm}-${String(d).padStart(2, '0')}`;
    const m = byDate.get(iso);
    const dots = m
      ? `<span class="dots">${m.income ? '<i class="dot in"></i>' : ''}${m.expense ? '<i class="dot out"></i>' : ''}${m.transfer ? '<i class="dot move"></i>' : ''}</span>`
      : '';
    cells.push(`<a class="day ${iso === p.day ? 'selected' : ''} ${iso === today ? 'today' : ''} ${m ? 'has' : ''}" href="${hash({ ...p, day: iso })}">
      <span class="day-num">${d}</span>${dots}${m ? `<small>${m.count}</small>` : ''}</a>`);
  }

  // Detail: hari terpilih, atau daftar hasil bila ada filter/pencarian aktif
  let detail = '';
  const filtersActive = p.acc !== 'all' || p.kind !== 'all' || p.cat || p.q;
  if (p.day) {
    const rows = monthRows.filter((r) => r.date === p.day).sort((a, b) => (a.time < b.time ? -1 : 1));
    const sum = (kind) => rows.filter((r) => r.kind === kind).reduce((n, r) => n + r.amount, 0);
    const fees = rows.filter((r) => r.kind === 'transfer').reduce((n, r) => n + r.fee, 0);
    detail = `
      <section class="card day-detail">
        <header class="card-head">
          <div><h2>${esc(dayNameID(p.day))}</h2><p class="muted">${esc(formatDateLong(p.day))}</p></div>
          <a class="link" href="${hash({ ...p, day: '' })}">Tutup detail</a>
        </header>
        <div class="day-totals">
          <div><span class="stat-label">Pemasukan</span>${amt(sum('income'), 'in')}</div>
          <div><span class="stat-label">Pengeluaran${fees ? ' (+biaya)' : ''}</span>${amt(sum('expense') + fees, 'out')}</div>
          <div><span class="stat-label">Transfer</span>${amt(sum('transfer'), 'move')}</div>
        </div>
        <div class="rows">${rows.length ? rows.map((r) => rowHTML(r)).join('') : '<div class="empty"><p>Tidak ada transaksi pada tanggal ini.</p></div>'}</div>
      </section>`;
  } else if (filtersActive) {
    const rows = monthRows.slice(0, 200);
    const groups = [];
    for (const r of rows) {
      const last = groups[groups.length - 1];
      if (last && last.date === r.date) last.items.push(r);
      else groups.push({ date: r.date, items: [r] });
    }
    detail = `
      <section class="card">
        <header class="card-head"><h2>Hasil filter</h2><span class="muted">${monthRows.length} data${monthRows.length > 200 ? ' (200 pertama)' : ''}</span></header>
        ${groups.length
          ? groups.map((g) => `<div class="group-date"><strong>${esc(dayNameID(g.date))}, ${esc(formatDateLong(g.date))}</strong></div><div class="rows">${g.items.map((r) => rowHTML(r)).join('')}</div>`).join('')
          : '<div class="empty"><p>Tidak ada data yang cocok dengan filter.</p></div>'}
      </section>`;
  }

  const accountOpts = [{ value: 'all', label: 'Semua ATM' }, ...data.accounts.map((a) => ({ value: a.id, label: a.name + (a.archivedAt ? ' (diarsipkan)' : '') }))];
  const catOpts = [{ value: '', label: 'Semua kategori' }, ...data.categories.map((c) => ({ value: c.id, label: `${c.name} (${c.type === 'income' ? 'masuk' : 'keluar'})` }))];
  const monthIn = monthRows.filter((r) => r.kind === 'income').reduce((n, r) => n + r.amount, 0);

  return `
    <section class="card">
      <div class="level"><span class="level-label">Tahun</span><div class="chips">${yearChips}</div></div>
      <div class="level"><span class="level-label">Bulan</span><div class="month-grid">${monthChips}</div></div>
    </section>

    <section class="card">
      <form class="filters" data-form="hist-search" autocomplete="off">
        <label class="field"><span>ATM</span><select data-change="hist-filter" data-key="acc">${optionList(accountOpts, p.acc)}</select></label>
        <label class="field"><span>Jenis</span><select data-change="hist-filter" data-key="jenis">${optionList(KINDS, p.kind)}</select></label>
        <label class="field"><span>Kategori</span><select data-change="hist-filter" data-key="kat">${optionList(catOpts, p.cat)}</select></label>
        <label class="field search"><span>Cari keterangan</span>
          <div class="search-box">${icon('search')}<input name="q" value="${esc(p.q)}" placeholder="Contoh: makan, listrik, gaji"></div></label>
      </form>
    </section>

    <section class="card">
      <header class="card-head"><h2>${esc(monthNameID(p.month - 1))} ${p.year}</h2>
        <span class="muted">${monthRows.length} transaksi · ${amt(monthIn, 'in')} masuk</span></header>
      <div class="calendar">
        ${WEEK.map((w) => `<span class="wk">${w}</span>`).join('')}
        ${cells.join('')}
      </div>
      <div class="legend"><span class="legend-item"><i class="dot in"></i>Pemasukan</span><span class="legend-item"><i class="dot out"></i>Pengeluaran</span><span class="legend-item"><i class="dot move"></i>Transfer</span></div>
    </section>
    ${detail}`;
}

const changes = {
  'hist-filter': (el) => {
    const p = readParams(currentQuery());
    const map = { acc: 'acc', jenis: 'kind', kat: 'cat' };
    const next = { ...p, [map[el.dataset.key]]: el.value };
    location.hash = hash(next);
  },
};

const forms = {
  'hist-search': (form) => {
    const p = readParams(currentQuery());
    const q = String(new FormData(form).get('q') || '').trim();
    location.hash = hash({ ...p, q });
  },
};

function currentQuery() {
  const [, qs = ''] = location.hash.replace(/^#/, '').split('?');
  return new URLSearchParams(qs);
}

export default {
  title: () => 'Riwayat',
  render,
  actions: {},
  forms,
  changes,
};
