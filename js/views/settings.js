// Pengaturan: keamanan (ganti PIN, kunci otomatis, kunci sekarang), kategori (tambah/ubah/hapus).
import { state, refresh } from '../state.js';
import { updateSettings, createCategory, updateCategory, deleteCategory, ValidationError } from '../services/finance.js';
import { verifyPin, createPinRecord, validatePinFormat } from '../core/security.js';
import { esc, icon, optionList, fieldError, openModal, closeModal, confirmDialog, toast } from '../ui/dom.js';

const AUTO_LOCK = [
  { value: '0', label: 'Tidak pernah (tidak disarankan)' },
  { value: '1', label: '1 menit' },
  { value: '5', label: '5 menit' },
  { value: '15', label: '15 menit' },
  { value: '30', label: '30 menit' },
  { value: '60', label: '60 menit' },
];

function categoryCounts() {
  const counts = new Map();
  for (const t of state.data.transactions) counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1);
  return counts;
}

function categoriesHTML() {
  const counts = categoryCounts();
  const group = (type, title) => {
    const list = state.data.categories
      .filter((c) => c.type === type)
      .sort((a, b) => a.name.localeCompare(b.name, 'id'));
    return `
      <h3 class="sub">${title}</h3>
      <div class="cat-list">${list.map((c) => {
        const used = counts.get(c.id) || 0;
        return `<div class="cat-item">
          <span class="cat-name">${esc(c.name)}</span>
          <span class="muted small">${used} transaksi</span>
          <button class="icon-btn" data-action="cat-edit" data-id="${esc(c.id)}" aria-label="Ubah kategori">${icon('edit')}</button>
          <button class="icon-btn danger" data-action="cat-delete" data-id="${esc(c.id)}" aria-label="Hapus kategori" ${used ? 'disabled title="Dipakai transaksi"' : ''}>${icon('trash')}</button>
        </div>`;
      }).join('') || '<p class="muted small">Belum ada.</p>'}</div>`;
  };
  return `${group('expense', 'Pengeluaran')}${group('income', 'Pemasukan')}`;
}

function render({ settings }) {
  const autoLock = String(settings.autoLockMinutes ?? 5);
  return `
    <section class="card">
      <header class="card-head"><h2>${icon('shield')} Keamanan</h2></header>
      <form data-form="pin-change" class="form-grid" autocomplete="off">
        <label class="field span-2"><span>PIN saat ini</span><input type="password" name="old" inputmode="numeric" autocomplete="off" required></label>
        <label class="field"><span>PIN baru (4-8 digit)</span><input type="password" name="pin" inputmode="numeric" autocomplete="new-password" required></label>
        <label class="field"><span>Ulangi PIN baru</span><input type="password" name="confirm" inputmode="numeric" autocomplete="new-password" required></label>
        <div class="form-end span-2"><button class="btn btn-primary" type="submit">Ganti PIN</button></div>
      </form>
      <p class="hint">Di aplikasi ini kata sandi dan PIN adalah satu kunci yang sama. Mengganti PIN tidak mengubah data.</p>
      <div class="form-grid">
        <label class="field"><span>Kunci otomatis setelah tidak aktif</span>
          <select data-change="auto-lock">${optionList(AUTO_LOCK, autoLock)}</select></label>
        <div class="form-end"><button class="btn btn-ghost" data-action="lock-now">${icon('lock')}Kunci sekarang</button></div>
      </div>
      <p class="hint">Keamanan browser lokal tidak sama dengan keamanan server khusus. Siapa pun yang punya akses ke perangkat dan profil browser ini dapat mencoba menebak PIN secara offline. Gunakan PIN yang tidak mudah ditebak.</p>
    </section>

    <section class="card">
      <header class="card-head"><h2>${icon('tag')} Kategori</h2></header>
      <p class="muted">Kategori bebas ditambah, diubah, dan dihapus. Kategori yang sudah dipakai transaksi tidak bisa dihapus.</p>
      <form data-form="cat-create" class="filters" autocomplete="off">
        <label class="field"><span>Nama kategori baru</span><input name="name" maxlength="40" required placeholder="Contoh: Langganan"></label>
        <label class="field"><span>Jenis</span><select name="type">${optionList([{ value: 'expense', label: 'Pengeluaran' }, { value: 'income', label: 'Pemasukan' }], 'expense')}</select></label>
        <div class="form-end"><button class="btn btn-primary" type="submit">${icon('plus')}Tambah</button></div>
      </form>
      ${categoriesHTML()}
    </section>

    <section class="card">
      <header class="card-head"><h2>Tentang</h2></header>
      <p class="muted">MY FINANCE · Personal Finance Manager. Semua data disimpan lokal di browser (IndexedDB) dan tidak dikirim ke layanan eksternal. Aplikasi dapat dipakai offline setelah dimuat sekali.</p>
    </section>`;
}

const actions = {
  'cat-edit': (el) => {
    const c = state.data.categories.find((x) => x.id === el.dataset.id);
    if (!c) return;
    openCategoryForm(c);
  },
  'cat-delete': async (el) => {
    const c = state.data.categories.find((x) => x.id === el.dataset.id);
    const ok = await confirmDialog(`Kategori "${c?.name}" akan dihapus.`, { title: 'Hapus kategori?', confirmText: 'Hapus', danger: true });
    if (!ok) return;
    await deleteCategory(el.dataset.id);
    toast('Kategori dihapus dan tercatat di log.');
    await refresh();
  },
};

function openCategoryForm(c, errors = {}, value = null) {
  openModal({
    title: 'Ubah kategori',
    body: `<form data-form="cat-save" class="stack" autocomplete="off">
      <input type="hidden" name="id" value="${esc(c.id)}">
      <label class="field"><span>Nama</span><input name="name" maxlength="40" value="${esc(value ?? c.name)}" required>${fieldError(errors, 'name')}</label>
      <p class="hint">Jenis: ${c.type === 'income' ? 'Pemasukan' : 'Pengeluaran'} (tidak dapat diubah)</p>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="modal-close">Batal</button><button class="btn btn-primary" type="submit">Simpan</button></div>
    </form>`,
  });
}

const forms = {
  'pin-change': async (form) => {
    const fd = new FormData(form);
    const old = String(fd.get('old') || '');
    const pin = String(fd.get('pin') || '');
    const confirm = String(fd.get('confirm') || '');
    const fmt = validatePinFormat(pin);
    if (fmt) throw new Error(fmt);
    if (pin !== confirm) throw new Error('Konfirmasi PIN baru tidak sama.');
    const ok = await verifyPin(old, state.settings.securitySettings.pin);
    if (!ok) throw new Error('PIN saat ini salah.');
    const record = await createPinRecord(pin);
    state.settings = await updateSettings({ securitySettings: { pin: record, failedAttempts: 0, lockedUntil: 0 } });
    form.reset();
    toast('PIN berhasil diganti.');
  },
  'cat-create': async (form) => {
    const fd = new FormData(form);
    try {
      await createCategory(String(fd.get('name') || ''), String(fd.get('type') || 'expense'));
      toast('Kategori ditambahkan.');
      await refresh();
    } catch (err) {
      if (err instanceof ValidationError) throw new Error(Object.values(err.errors)[0]);
      throw err;
    }
  },
  'cat-save': async (form) => {
    const fd = new FormData(form);
    const id = String(fd.get('id'));
    const name = String(fd.get('name') || '');
    try {
      await updateCategory(id, name);
      closeModal();
      toast('Kategori diubah dan tercatat di log.');
      await refresh();
    } catch (err) {
      if (err instanceof ValidationError) {
        const c = state.data.categories.find((x) => x.id === id);
        openCategoryForm(c, err.errors, name);
        return;
      }
      throw err;
    }
  },
};

const changes = {
  'auto-lock': async (el) => {
    state.settings = await updateSettings({ autoLockMinutes: Number(el.value) });
    toast(Number(el.value) ? `Kunci otomatis: ${el.options[el.selectedIndex].text}.` : 'Kunci otomatis dimatikan.');
  },
};

export default {
  title: () => 'Pengaturan',
  render: (ctx) => render({ ...ctx, settings: state.settings }),
  actions,
  forms,
  changes,
};
