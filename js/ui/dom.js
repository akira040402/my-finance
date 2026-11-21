// Utilitas UI: escape HTML, ikon (gaya Lucide, inline SVG), modal, konfirmasi, toast.
import { formatRupiah } from '../core/money.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Path ikon bergaya Lucide (lisensi ISC), digambar ulang sebagai SVG inline agar offline.
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="15" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  transfer: '<path d="M7 7h11l-3-3"/><path d="M17 17H6l3 3"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 21h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8"/><path d="M10 12h4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/** Nominal dengan warna sesuai jenis: 'in' hijau, 'out' merah, 'move' biru, lainnya netral. */
export function amt(value, kind = 'neutral', { sign = false } = {}) {
  return `<span class="amt amt-${kind}">${esc(formatRupiah(value, { sign }))}</span>`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function optionList(items, selected, { placeholder = null } = {}) {
  const head = placeholder !== null ? `<option value="" ${!selected ? 'selected' : ''}>${esc(placeholder)}</option>` : '';
  return head + items
    .map((it) => `<option value="${esc(it.value)}" ${String(it.value) === String(selected ?? '') ? 'selected' : ''}>${esc(it.label)}</option>`)
    .join('');
}

export function fieldError(errors, key) {
  return errors && errors[key] ? `<div class="field-error">${esc(errors[key])}</div>` : '';
}

/* ---------- Modal ---------- */

export function openModal({ title, body, footer = '', wide = false, id = 'modal' }) {
  closeModal();
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-backdrop>
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-title" data-modal="${id}">
        <header class="modal-head">
          <h2 id="${id}-title">${esc(title)}</h2>
          <button class="icon-btn" data-action="modal-close" aria-label="Tutup">${icon('x')}</button>
        </header>
        <div class="modal-body">${body}</div>
        ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
      </div>
    </div>`;
  const first = root.querySelector('input, select, textarea, button.btn-primary');
  if (first && first.tagName !== 'BUTTON') setTimeout(() => first.focus(), 30);
  return root.querySelector('.modal');
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

export function confirmDialog(message, { title = 'Konfirmasi', confirmText = 'Ya, lanjutkan', danger = false, typeToConfirm = null } = {}) {
  return new Promise((resolve) => {
    const typeField = typeToConfirm
      ? `<label class="field"><span>Ketik <b>${esc(typeToConfirm)}</b> untuk melanjutkan</span><input id="confirm-input" autocomplete="off"></label>`
      : '';
    openModal({
      title,
      body: `<p class="muted">${esc(message)}</p>${typeField}`,
      footer: `<button class="btn btn-ghost" data-action="confirm-no">Batal</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm-yes" ${typeToConfirm ? 'disabled' : ''}>${esc(confirmText)}</button>`,
    });
    const root = document.getElementById('modal-root');
    const yes = root.querySelector('[data-action="confirm-yes"]');
    const input = root.querySelector('#confirm-input');
    if (input) {
      input.addEventListener('input', () => {
        yes.disabled = input.value.trim() !== typeToConfirm;
      });
    }
    const done = (val) => {
      root.removeEventListener('click', onClick);
      closeModal();
      resolve(val);
    };
    const onClick = (e) => {
      // Backdrop hanya menutup jika yang diklik benar-benar backdrop, bukan isi modal.
      if (e.target.matches?.('[data-backdrop]')) return done(false);
      const act = e.target.closest('[data-action]')?.dataset.action;
      if (act === 'confirm-yes') done(true);
      if (act === 'confirm-no' || act === 'modal-close') done(false);
    };
    root.addEventListener('click', onClick);
  });
}

/* ---------- Toast ---------- */

export function toast(message, kind = 'ok') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

export function errorMessage(err) {
  if (err?.name === 'ValidationError') {
    const first = Object.values(err.errors || {})[0];
    return first || err.message;
  }
  return err?.message || 'Terjadi kesalahan.';
}
