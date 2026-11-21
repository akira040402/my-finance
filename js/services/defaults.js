// Kategori awal saat pertama kali aplikasi dijalankan. Pengguna bebas menambah, mengubah, dan menghapusnya.
// Tidak ada ATM atau transaksi contoh; data keuangan selalu berasal dari input pengguna.
export const DEFAULT_CATEGORIES = [
  { name: 'Makanan', type: 'expense' },
  { name: 'Minuman', type: 'expense' },
  { name: 'Bensin', type: 'expense' },
  { name: 'Parkir', type: 'expense' },
  { name: 'Token listrik', type: 'expense' },
  { name: 'Internet', type: 'expense' },
  { name: 'Belanja', type: 'expense' },
  { name: 'Transportasi', type: 'expense' },
  { name: 'Kesehatan', type: 'expense' },
  { name: 'Hiburan', type: 'expense' },
  { name: 'Tagihan', type: 'expense' },
  { name: 'Lainnya', type: 'expense' },
  { name: 'Gaji', type: 'income' },
  { name: 'Bonus', type: 'income' },
  { name: 'Uang tambahan', type: 'income' },
  { name: 'Lainnya', type: 'income' },
];
