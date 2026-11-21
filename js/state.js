// State bersama antar-halaman. Data dimuat dari IndexedDB; setiap perubahan memanggil refresh().
import { loadData } from './services/finance.js';

export const state = {
  data: null,
  settings: null,
  unlocked: false,
};

// Diisi oleh app.js saat boot (menghindari dependensi melingkar).
export const bus = {
  render: () => {},
};

export async function refresh() {
  state.data = await loadData();
  bus.render();
}
