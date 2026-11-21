// Keamanan lokal memakai Web Crypto API.
// PENTING: ini melindungi akses ke aplikasi di browser ini. Keamanan browser lokal
// TIDAK sama dengan keamanan server khusus; siapa pun yang punya akses fisik & akun OS
// dapat mencoba menebak PIN secara offline dari data tersimpan.

const enc = new TextEncoder();
const dec = new TextDecoder();
export const PBKDF2_ITERATIONS = 250000;
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

const b64 = {
  encode(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  },
  decode(str) {
    const s = atob(str);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

export function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

async function deriveBits(secret, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function validatePinFormat(pin) {
  if (!/^\d+$/.test(pin)) return 'PIN hanya boleh berisi angka.';
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    return `PIN harus ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digit.`;
  }
  return null;
}

/** Buat catatan PIN: salt unik + hash PBKDF2. PIN asli tidak pernah disimpan. */
export async function createPinRecord(pin) {
  const salt = randomBytes(16);
  const hash = await deriveBits(pin, salt, PBKDF2_ITERATIONS);
  return {
    algo: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: b64.encode(salt),
    hash: b64.encode(hash),
  };
}

export async function verifyPin(pin, record) {
  if (!record?.salt || !record?.hash) return false;
  const hash = await deriveBits(pin, b64.decode(record.salt), record.iterations || PBKDF2_ITERATIONS);
  return constantTimeEqual(hash, b64.decode(record.hash));
}

/**
 * Jeda (ms) setelah sejumlah percobaan gagal.
 * 0-2 gagal: tanpa jeda. 3 gagal: 30 dtk, lalu dua kali lipat setiap kegagalan, maksimal 15 menit.
 */
export function lockoutDelayMs(failedAttempts) {
  if (failedAttempts < 3) return 0;
  const delay = 30_000 * 2 ** (failedAttempts - 3);
  return Math.min(delay, 15 * 60_000);
}

async function deriveAesKey(passphrase, salt, iterations) {
  const bits = await deriveBits(passphrase, salt, iterations);
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Enkripsi teks (JSON backup) dengan passphrase. Mengembalikan envelope JSON. */
export async function encryptText(plainText, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plainText));
  return {
    encrypted: true,
    format: 'AES-GCM-256/PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: b64.encode(salt),
    iv: b64.encode(iv),
    ciphertext: b64.encode(new Uint8Array(cipher)),
  };
}

/** Dekripsi envelope. Melempar error jika passphrase salah atau file rusak. */
export async function decryptEnvelope(envelope, passphrase) {
  try {
    const key = await deriveAesKey(passphrase, b64.decode(envelope.salt), envelope.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64.decode(envelope.iv) },
      key,
      b64.decode(envelope.ciphertext),
    );
    return dec.decode(plain);
  } catch (_) {
    throw new Error('Kata sandi backup salah atau file backup rusak.');
  }
}
