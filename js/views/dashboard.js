// Beranda: total saldo (dari database), pemasukan/pengeluaran bulan ini, grafik, daftar ATM, transaksi terbaru.
import { computeBalances, summarize, monthlySeries, toRows, periodRange, isCountedInTotal } from '../core/ledger.js';
import { formatRupiah, monthNameID } from '../core/money.js';
import { esc, icon, amt, todayISO } from '../ui/dom.js';
import { barChart } from '../ui/charts.js';
import { rowsHTML } from '../ui/rows.js';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function render({ data }) {
  const active = data.accounts.filter((a) => !a.archivedAt);
  if (active.length === 0) {
    return `
      <section class="hero-empty card">
        <div class="hero-ic">${icon('wallet')}</div>
        <h2>Mulai dengan menambah ATM</h2>
        <p class="muted">ATM bisa berupa rekening bank, dompet, tabungan, atau tempat penyimpanan uang lainnya. Anda bisa menambah ATM sebanyak yang dibutuhkan.</p>
        <button class="btn btn-primary" data-action="account-new">${icon('plus')}Tambah ATM pertama</button>
      </section>`;
  }

  const { total, byAccount } = computeBalances(data);
  const today = todayISO();
  const { from, to } = periodRange('month', today);
  const s = summarize(data, { from, to });
  const series = monthlySeries(data, Number(today.slice(0, 4)));
  const recent = toRows(data).slice(0, 8);
  const monthLabel = `${monthNameID(Number(today.slice(5, 7)) - 1)} ${today.slice(0, 4)}`;

  return `
    <section class="stats">
      <article class="stat stat-primary">
        <span class="stat-label">Total seluruh saldo</span>
        <strong class="stat-value">${esc(formatRupiah(total))}</strong>
        <span class="stat-foot">${active.filter((a) => isCountedInTotal(a)).length} ATM ikut total</span>
      </article>
      <article class="stat">
        <span class="stat-label">Pemasukan ${esc(monthLabel)}</span>
        <strong class="stat-value amt-in">${esc(formatRupiah(s.income))}</strong>
      </article>
      <article class="stat">
        <span class="stat-label">Pengeluaran ${esc(monthLabel)}</span>
        <strong class="stat-value amt-out">${esc(formatRupiah(s.expense))}</strong>
        ${s.fees ? `<span class="stat-foot">termasuk biaya admin ${esc(formatRupiah(s.fees))}</span>` : ''}
      </article>
      <article class="stat">
        <span class="stat-label">Jumlah ATM</span>
        <strong class="stat-value">${active.length}</strong>
        <span class="stat-foot">${data.accounts.length - active.length} diarsipkan</span>
      </article>
    </section>

    <div class="actions-bar">
      <button class="btn btn-in" data-action="tx-new" data-type="income">${icon('arrowDown')}Pemasukan</button>
      <button class="btn btn-out" data-action="tx-new" data-type="expense">${icon('arrowUp')}Pengeluaran</button>
      <button class="btn btn-move" data-action="transfer-new">${icon('transfer')}Transfer</button>
      <button class="btn btn-ghost" data-action="account-new">${icon('plus')}Tambah ATM</button>
    </div>

    <div class="grid-2">
      <section class="card">
        <header class="card-head"><h2>Pemasukan & pengeluaran ${esc(today.slice(0, 4))}</h2>
          <a class="link" href="#/laporan">Laporan</a></header>
        ${barChart({
          labels: MONTH_SHORT,
          series: [
            { name: 'Pemasukan', color: 'var(--income)', values: series.map((m) => m.income) },
            { name: 'Pengeluaran', color: 'var(--expense)', values: series.map((m) => m.expense) },
          ],
          height: 220,
          ariaLabel: 'Grafik pemasukan dan pengeluaran per bulan',
        })}
      </section>

      <section class="card">
        <header class="card-head"><h2>Daftar ATM</h2><a class="link" href="#/atm">Kelola</a></header>
        <div class="acc-list">
          ${active
            .map((a) => `
              <a class="acc-item" href="#/atm/${esc(a.id)}">
                <span class="acc-dot"></span>
                <span class="acc-name">${esc(a.name)}</span>
                <span class="acc-bal">${esc(formatRupiah(byAccount.get(a.id) ?? 0))}</span>
              </a>`)
            .join('')}
        </div>
      </section>
    </div>

    <section class="card">
      <header class="card-head"><h2>Transaksi terbaru</h2><a class="link" href="#/riwayat">Semua riwayat</a></header>
      ${rowsHTML(recent, { showDate: true })}
    </section>
    <p class="hint center">Ringkasan bulan ini: ${amt(s.income, 'in')} masuk, ${amt(s.expense, 'out')} keluar, ${s.transferCount} transfer (tidak dihitung sebagai pemasukan/pengeluaran).</p>`;
}

export default {
  title: () => 'Beranda',
  render,
  actions: {},
  forms: {},
  changes: {},
};
