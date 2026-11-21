// Persiapan impor CSV: pemetaan kolom, validasi per baris, dan deteksi duplikasi.
// Murni (tidak menulis apa pun). Hasilnya dipakai UI untuk preview lalu disimpan oleh services/finance.js.
import { parseRupiah, normalizeDateInput, isValidTime } from './money.js';

const TYPE_ALIASES = {
  pemasukan: 'income', masuk: 'income', income: 'income', in: 'income',
  pengeluaran: 'expense', keluar: 'expense', expense: 'expense', out: 'expense',
};

/** Nilai nominal yang ambigu (mis. "15000,50" atau "15000.5") ditolak agar tidak salah dibaca. */
function parseAmountStrict(raw) {
  const s = String(raw ?? '').trim();
  if (/[.,]\d{1,2}$/.test(s)) return NaN;
  return parseRupiah(s);
}

/**
 * @param {{rows: object[]}} parsed hasil parseCSV
 * @param {object} mapping { date, time, type, account, amount, category, description, source, purpose } -> nama kolom CSV ('' = tidak dipakai)
 * @param {{accounts: object[], categories: object[], transactions: object[]}} data
 */
export function prepareImport(parsed, mapping, data) {
  const activeAccounts = data.accounts.filter((a) => !a.archivedAt);
  const accountByName = new Map(activeAccounts.map((a) => [a.name.toLowerCase(), a]));
  const existingKeys = new Set(
    data.transactions
      .filter((t) => !t.deletedAt)
      .map((t) => keyOf(t.date, t.time, t.accountId, t.type, t.amount, t.description)),
  );
  const newCats = new Map();
  const valid = [];
  const invalid = [];
  const duplicates = [];
  const seenInFile = new Set();

  const get = (row, field) => (mapping[field] ? row[mapping[field]] ?? '' : '');

  parsed.rows.forEach((row, idx) => {
    const line = idx + 2; // baris 1 = header
    const errors = [];

    const date = normalizeDateInput(get(row, 'date'));
    if (!date) errors.push('Tanggal tidak valid (gunakan YYYY-MM-DD atau dd/mm/yyyy).');

    let time = get(row, 'time') || '00:00';
    if (!isValidTime(time)) errors.push('Jam tidak valid (HH:MM).');

    const type = TYPE_ALIASES[get(row, 'type').trim().toLowerCase()];
    if (!type) errors.push('Jenis harus "pemasukan" atau "pengeluaran".');

    const account = accountByName.get(get(row, 'account').trim().toLowerCase());
    if (!account) errors.push('ATM tidak ditemukan atau sudah diarsipkan.');

    const amount = parseAmountStrict(get(row, 'amount'));
    if (!Number.isSafeInteger(amount) || amount <= 0) errors.push('Nominal harus bilangan bulat lebih dari 0.');

    const categoryName = get(row, 'category').trim() || 'Lainnya';

    if (errors.length) {
      invalid.push({ line, errors, raw: row });
      return;
    }

    const description = get(row, 'description').trim();
    const key = keyOf(date, time, account.id, type, amount, description);
    if (existingKeys.has(key) || seenInFile.has(key)) {
      duplicates.push({ line, raw: row });
      return;
    }
    seenInFile.add(key);

    const catExists = data.categories.some(
      (c) => c.type === type && c.name.toLowerCase() === categoryName.toLowerCase(),
    );
    if (!catExists) {
      const nk = `${type}|${categoryName.toLowerCase()}`;
      if (!newCats.has(nk)) newCats.set(nk, { name: categoryName, type });
    }

    valid.push({
      line,
      row: {
        type,
        accountId: account.id,
        amount,
        date,
        time,
        categoryName,
        source: get(row, 'source').trim(),
        purpose: get(row, 'purpose').trim(),
        description,
      },
    });
  });

  return {
    valid,
    invalid,
    duplicates,
    newCategories: [...newCats.values()],
    counts: { total: parsed.rows.length, valid: valid.length, invalid: invalid.length, duplicates: duplicates.length },
  };
}

function keyOf(date, time, accountId, type, amount, description) {
  return [date, time, accountId, type, amount, (description || '').trim().toLowerCase()].join('|');
}

/** Pemetaan kolom standar untuk ekspor CSV aplikasi ini. */
export const EXPORT_COLUMNS = [
  { key: 'id', label: 'id' },
  { key: 'date', label: 'tanggal' },
  { key: 'time', label: 'jam' },
  { key: 'type', label: 'jenis' },
  { key: 'account', label: 'atm' },
  { key: 'toAccount', label: 'atm_tujuan' },
  { key: 'category', label: 'kategori' },
  { key: 'amount', label: 'nominal' },
  { key: 'fee', label: 'biaya_admin' },
  { key: 'source', label: 'sumber' },
  { key: 'purpose', label: 'keperluan' },
  { key: 'description', label: 'keterangan' },
];
