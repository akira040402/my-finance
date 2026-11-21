// Utilitas uang & tanggal. Semua nominal disimpan sebagai integer rupiah.

export const CURRENCY = 'Rp';

/** Ubah input bebas ("1.500.000", "Rp 25rb"-style tidak didukung, hanya angka) menjadi integer. */
export function parseRupiah(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input) : NaN;
  }
  const raw = String(input ?? '').trim();
  if (raw === '') return NaN;
  // Hanya angka dan tanda minus yang diterima; pemisah ribuan (titik/koma/spasi) dibuang.
  const cleaned = raw.replace(/[^\d-]/g, '');
  if (cleaned === '' || cleaned === '-') return NaN;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : NaN;
}

const idr = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export function formatRupiah(amount, { sign = false } = {}) {
  const n = Math.round(Number(amount) || 0);
  const body = `${CURRENCY} ${idr.format(Math.abs(n))}`;
  if (n < 0) return `-${body}`;
  if (sign && n > 0) return `+${body}`;
  return body;
}

export function formatNumber(amount) {
  return idr.format(Math.round(Number(amount) || 0));
}

const pad = (n) => String(n).padStart(2, '0');

/** Tanggal lokal dalam format YYYY-MM-DD (ISO). */
export function toISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Jam lokal dalam format HH:MM. */
export function toISOTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Parse tanggal dari ISO (YYYY-MM-DD) atau dd/mm/yyyy. Mengembalikan ISO atau null. */
export function normalizeDateInput(s) {
  const raw = String(s ?? '').trim();
  if (isValidISODate(raw)) return raw;
  const m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    return isValidISODate(iso) ? iso : null;
  }
  return null;
}

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export const monthNameID = (monthIndex0) => MONTHS_ID[monthIndex0];
export const dayNameID = (isoDate) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return DAYS_ID[new Date(y, m - 1, d).getDay()];
};

export function formatDateLong(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return toISODate(dt);
}

export function daysInMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate();
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
