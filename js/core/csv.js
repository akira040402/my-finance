// Parser & penulis CSV (RFC 4180) tanpa dependensi. Mendukung pemisah koma atau titik-koma.

export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  return semis > commas ? ';' : ',';
}

/** Parse teks CSV menjadi { headers, rows } . Baris kosong dilewati. */
export function parseCSV(text, delimiter = detectDelimiter(text)) {
  const src = text.replace(/^﻿/, '');
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('CSV tidak valid: tanda kutip tidak ditutup.');
  if (field !== '' || row.length) {
    row.push(field);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows };
}

function escapeCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Ubah daftar objek menjadi teks CSV. columns: [{ key, label }]. */
export function toCSV(records, columns) {
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const lines = records.map((r) => columns.map((c) => escapeCell(r[c.key])).join(','));
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}

/** Tebak pemetaan kolom berdasarkan nama header yang umum. */
export function guessMapping(headers) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  const candidates = {
    date: ['tanggal', 'date', 'tgl'],
    time: ['jam', 'time', 'waktu'],
    type: ['jenis', 'type', 'tipe'],
    account: ['atm', 'akun', 'account', 'rekening'],
    amount: ['nominal', 'amount', 'jumlah', 'nilai'],
    category: ['kategori', 'category'],
    description: ['keterangan', 'description', 'catatan', 'deskripsi'],
    source: ['sumber', 'source'],
    purpose: ['keperluan', 'purpose', 'tujuan'],
  };
  const map = {};
  for (const [field, names] of Object.entries(candidates)) {
    const idx = headers.findIndex((h) => names.includes(norm(h)));
    map[field] = idx >= 0 ? headers[idx] : '';
  }
  return map;
}
