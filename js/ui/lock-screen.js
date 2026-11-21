// Layar setup PIN (pertama kali) dan layar masuk PIN, termasuk jeda setelah percobaan salah.
import { esc, icon, errorMessage, confirmDialog } from './dom.js';
import { validatePinFormat, createPinRecord, verifyPin, lockoutDelayMs } from '../core/security.js';
import { updateSettings, resetEverything } from '../services/finance.js';

/** Pemulihan: hanya lewat reset total lalu restore file backup. Tidak ada jalan pintas tanpa backup. */
async function showRecovery(settings, onSuccess) {
  const root = document.getElementById('lock-root');
  root.innerHTML = `<div class="lock-wrap"><div class="lock-card">
    ${'<div class="lock-brand"><div class="brand-mark">' + icon('shield') + '</div><h1>Pemulihan akses</h1></div>'}
    <div class="stack">
      <p class="muted">Data keuangan tidak bisa dibuka tanpa PIN. Satu-satunya jalur pemulihan adalah <strong>menghapus data di browser ini</strong>, lalu memulihkan file backup JSON Anda.</p>
      <p class="hint">Jika Anda tidak punya file backup, data yang tersimpan di browser ini tidak dapat dikembalikan.</p>
      <button class="btn btn-danger btn-block" id="reset-btn">Hapus data di browser ini</button>
      <button class="btn btn-ghost btn-block" id="back-btn">Kembali</button>
    </div></div></div>`;
  root.querySelector('#back-btn').addEventListener('click', () => showUnlock(settings, onSuccess));
  root.querySelector('#reset-btn').addEventListener('click', async () => {
    const ok = await confirmDialog('Seluruh data ATM, transaksi, transfer, kategori, dan log di browser ini akan dihapus permanen.', {
      title: 'Hapus semua data?', confirmText: 'Hapus permanen', danger: true, typeToConfirm: 'HAPUS',
    });
    if (!ok) return;
    try {
      await resetEverything();
      location.reload();
    } catch (err) {
      alert(errorMessage(err));
    }
  });
}

const mount = (html) => {
  const root = document.getElementById('lock-root');
  root.innerHTML = `<div class="lock-wrap"><div class="lock-card">${html}</div></div>`;
  root.hidden = false;
  return root;
};

export function hideLockScreen() {
  const root = document.getElementById('lock-root');
  root.innerHTML = '';
  root.hidden = true;
}

const brandHead = (sub) => `
  <div class="lock-brand">
    <div class="brand-mark">${icon('wallet')}</div>
    <h1>MY FINANCE</h1>
    <p class="muted">${esc(sub)}</p>
  </div>`;

/** Setup PIN untuk pertama kali. onDone dipanggil setelah PIN tersimpan. */
export function showSetup(onDone) {
  const root = mount(`
    ${brandHead('Buat PIN untuk melindungi data keuangan Anda.')}
    <form id="setup-form" class="stack" autocomplete="off">
      <label class="field"><span>PIN baru (${4}-${8} digit angka)</span>
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" required></label>
      <label class="field"><span>Ulangi PIN</span>
        <input name="confirm" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" required></label>
      <p class="field-error" id="setup-error" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">Simpan PIN & Mulai</button>
      <p class="hint">PIN disimpan sebagai hash PBKDF2 dengan salt unik. PIN asli tidak pernah disimpan. Keamanan browser lokal tidak sama dengan keamanan server khusus.</p>
    </form>`);
  const form = root.querySelector('#setup-form');
  const err = root.querySelector('#setup-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = form.pin.value.trim();
    const confirm = form.confirm.value.trim();
    const fmt = validatePinFormat(pin);
    if (fmt) return (err.textContent = fmt);
    if (pin !== confirm) return (err.textContent = 'Konfirmasi PIN tidak sama.');
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const record = await createPinRecord(pin);
      await updateSettings({ securitySettings: { pin: record, failedAttempts: 0, lockedUntil: 0 } });
      onDone();
    } catch (ex) {
      err.textContent = errorMessage(ex);
      btn.disabled = false;
    }
  });
}

/** Layar masuk. onSuccess dipanggil saat PIN benar. */
export function showUnlock(settings, onSuccess) {
  const root = mount(`
    ${brandHead('Masukkan PIN untuk melanjutkan.')}
    <form id="unlock-form" class="stack" autocomplete="off">
      <label class="field"><span>PIN</span>
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" required autofocus></label>
      <p class="field-error" id="unlock-error" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">Buka</button>
      <button class="btn btn-link btn-block" type="button" id="forgot-pin">Lupa PIN?</button>
    </form>`);
  root.querySelector('#forgot-pin').addEventListener('click', () => showRecovery(settings, onSuccess));
  const form = root.querySelector('#unlock-form');
  const err = root.querySelector('#unlock-error');
  const input = form.pin;
  let timer = null;

  const sec = () => settings.securitySettings || {};
  const remaining = () => Math.max(0, (sec().lockedUntil || 0) - Date.now());

  const updateLockState = () => {
    const ms = remaining();
    input.disabled = ms > 0;
    form.querySelector('button').disabled = ms > 0;
    if (ms > 0) {
      err.textContent = `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(ms / 1000)} detik.`;
    } else if (timer) {
      clearInterval(timer);
      timer = null;
      err.textContent = '';
      input.focus();
    }
  };
  if (remaining() > 0) {
    timer = setInterval(updateLockState, 500);
    updateLockState();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (remaining() > 0) return updateLockState();
    const pin = input.value.trim();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const ok = await verifyPin(pin, sec().pin);
      if (ok) {
        await updateSettings({ securitySettings: { failedAttempts: 0, lockedUntil: 0 } });
        settings.securitySettings = { ...sec(), failedAttempts: 0, lockedUntil: 0 };
        onSuccess();
        return;
      }
      const failed = (sec().failedAttempts || 0) + 1;
      const delay = lockoutDelayMs(failed);
      const lockedUntil = delay ? Date.now() + delay : 0;
      await updateSettings({ securitySettings: { failedAttempts: failed, lockedUntil } });
      settings.securitySettings = { ...sec(), failedAttempts: failed, lockedUntil };
      input.value = '';
      err.textContent = `PIN salah (percobaan ke-${failed}).`;
      if (delay) {
        timer = setInterval(updateLockState, 500);
        updateLockState();
      }
    } catch (ex) {
      err.textContent = errorMessage(ex);
    } finally {
      if (remaining() === 0) btn.disabled = false;
    }
  });
}
