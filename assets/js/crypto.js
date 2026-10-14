/* ============================================================================
 * TERUEL · Núcleo criptográfico  (assets/js/crypto.js)
 * ----------------------------------------------------------------------------
 * Toda a privacidade do app mora aqui. Regras:
 *
 *   1. NADA sensível é gravado em texto puro — nem no aparelho, nem na nuvem.
 *   2. A chave-mestra da família (FMK) é aleatória (32 bytes) e NUNCA é
 *      derivada da senha. Ela é "embrulhada" (wrapped) individualmente para
 *      cada membro com uma chave derivada do PIN dele (PBKDF2-SHA256).
 *      Assim, cada pessoa tem seu próprio PIN, mas todas abrem o MESMO cofre.
 *   3. O cofre é selado com AES-256-GCM (autenticado: qualquer alteração
 *      maliciosa no arquivo faz a leitura falhar, em vez de corromper dados).
 *   4. Cada documento recebe uma chave própria (HKDF) — separação de chaves.
 *
 * Usamos apenas WebCrypto nativo (crypto.subtle). Nenhuma biblioteca externa:
 * menos superfície de ataque e nada de código de terceiros lendo o prontuário.
 * ==========================================================================*/

'use strict';

/* ---------------------------------------------------------------- constantes */
export const KDF = {
  ITERATIONS: 210000,   // custo do PBKDF2 (alto: dificulta ataque de força bruta)
  HASH: 'SHA-256',
  KEY_BITS: 256,
  SALT_BYTES: 16,
};

export const CIPHER = {
  NAME: 'AES-GCM',
  IV_BYTES: 12,         // nonce de 96 bits (recomendação NIST para GCM)
  TAG_BITS: 128,        // tag de autenticação
};

const te = new TextEncoder();
const td = new TextDecoder();

/* ------------------------------------------------------------------ utilitários */

/** Gera n bytes aleatórios criptograficamente seguros. */
export function randomBytes(n) {
  const u8 = new Uint8Array(n);
  crypto.getRandomValues(u8);
  return u8;
}

/** Uint8Array -> base64 (padrão). */
export function toB64(u8) {
  let s = '';
  const CHUNK = 0x8000;                       // evita estourar a pilha em arquivos grandes
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/** base64 -> Uint8Array. */
export function fromB64(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** base64 -> Uint8Array, tolerante a espaços/quebras vindas de arquivo. */
export function fromB64Loose(b64) {
  return fromB64(String(b64).replace(/\s+/g, ''));
}

/** Texto -> Uint8Array. */
export function bytes(str) { return te.encode(str); }

/** Uint8Array -> texto. */
export function text(u8) { return td.decode(u8); }

/** JSON -> objeto, sem explodir. */
export function parseJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

/** Hash SHA-256 em hexadecimal (identificadores, impressões digitais). */
export async function sha256Hex(input) {
  const u8 = typeof input === 'string' ? bytes(input) : input;
  const d = await crypto.subtle.digest('SHA-256', u8);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparação em tempo constante — evita vazar informação pelo tempo de resposta. */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ chaves */

/** Importa bytes crus como CryptoKey AES-GCM. */
export async function importAesKey(rawU8, usages = ['encrypt', 'decrypt']) {
  return crypto.subtle.importKey('raw', rawU8, { name: CIPHER.NAME }, false, usages);
}

/**
 * Deriva uma chave AES a partir de um PIN/senha.
 * PBKDF2-SHA256 com salt aleatório e 210k iterações.
 * Retorna { key, raw } — `raw` só é usado para embrulhar a chave-mestra.
 */
export async function keyFromPin(pin, saltU8, iterations = KDF.ITERATIONS) {
  const base = await crypto.subtle.importKey(
    'raw', bytes(pin), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltU8, iterations, hash: KDF.HASH },
    base,
    KDF.KEY_BITS
  );
  const raw = new Uint8Array(bits);
  return { key: await importAesKey(raw), raw };
}

/** Chave-mestra nova: 32 bytes aleatórios. Nunca sai do aparelho em claro. */
export function newMasterKey() { return randomBytes(32); }

/**
 * HKDF — deriva subchaves do cofre a partir da chave-mestra.
 * Ex.: deriveSubkey(fmk, 'vault') para o cofre; deriveSubkey(fmk, 'doc:<id>') para um laudo.
 */
export async function deriveSubkey(masterU8, info, bits = 256) {
  const master = await crypto.subtle.importKey('raw', masterU8, 'HKDF', false, ['deriveBits']);
  const raw = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: bytes(String(info)) },
    master,
    bits
  );
  return new Uint8Array(raw);
}

/* --------------------------------------------------------------- cifra/decifra */

/** Cifra bytes → { iv, ct } (ambos base64). `aad` amarra o contexto (anti-troca de bloco). */
export async function encryptBytes(key, u8, aad) {
  const iv = randomBytes(CIPHER.IV_BYTES);
  const params = { name: CIPHER.NAME, iv, tagLength: CIPHER.TAG_BITS };
  if (aad) params.additionalData = bytes(aad);
  const ct = await crypto.subtle.encrypt(params, key, u8);
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** Decifra { iv, ct } → Uint8Array. Lança se a autenticação falhar (PIN errado ou dado adulterado). */
export async function decryptBytes(key, payload, aad) {
  const params = { name: CIPHER.NAME, iv: fromB64(payload.iv), tagLength: CIPHER.TAG_BITS };
  if (aad) params.additionalData = bytes(aad);
  const pt = await crypto.subtle.decrypt(params, key, fromB64(payload.ct));
  return new Uint8Array(pt);
}

/** Cifra um objeto JSON. `aad` é obrigatório na prática (fixa o contexto). */
export async function sealObject(key, obj, aad) {
  return encryptBytes(key, bytes(JSON.stringify(obj)), aad);
}

/** Decifra para objeto JSON. */
export async function openObject(key, payload, aad) {
  const u8 = await decryptBytes(key, payload, aad);
  return parseJSON(text(u8));
}

/** Cifra texto simples. */
export async function sealText(key, str, aad) {
  return encryptBytes(key, bytes(str), aad);
}

/** Decifra texto simples. */
export async function openText(key, payload, aad) {
  const u8 = await decryptBytes(key, payload, aad);
  return text(u8);
}

/* ------------------------------------------- embrulho da chave-mestra por membro */

/**
 * Embrulha a chave-mestra da família usando a chave derivada do PIN do membro.
 * `membroId` entra como AAD: um blob roubado de um membro não pode ser
 * reaproveitado no registro de outro.
 */
export async function wrapMasterForMember(masterU8, pinKey, membroId) {
  return encryptBytes(pinKey, masterU8, 'membro:' + membroId);
}

/** Abre a chave-mestra com a chave do PIN. Lança se o PIN estiver errado. */
export async function unwrapMasterForMember(pinKey, payload, membroId) {
  return decryptBytes(pinKey, payload, 'membro:' + membroId);
}

/* ------------------------------------------------------------- conveniências */

/**
 * Monta o "contexto" (AAD) de uma operação. Amarrar o contexto à cifra impede
 * que um blob válido seja reutilizado em outro lugar (ex.: trocar o arquivo do
 * cofre pelo de outra família, ou mover um laudo para outro paciente).
 */
export function aesAad(...partes) {
  return 'teruel:v1:' + partes.filter(Boolean).join('|');
}

/** Deriva a chave de um documento a partir da chave-mestra. */
export async function documentKey(masterU8, docId) {
  const raw = await deriveSubkey(masterU8, 'doc:' + docId);
  return importAesKey(raw);
}

/** Impressão digital curta e legível da chave — para a família conferir se
 *  todos estão no MESMO cofre ("código do canal seguro"). */
export async function keyFingerprint(masterU8) {
  const h = await sha256Hex(masterU8);
  const groups = h.slice(0, 16).toUpperCase().match(/.{1,4}/g) || [];
  return 'TERUEL-' + groups.join('-');
}

/** Gera um PIN numérico forte por padrão (6 dígitos) — usado no convite de membro. */
export function suggestPin(digits = 6) {
  const n = randomBytes(digits);
  let out = '';
  for (let i = 0; i < digits; i++) out += String(n[i] % 10);
  // evita PINs triviais
  if (/^(\d)\1+$/.test(out) || out === '123456') return suggestPin(digits);
  return out;
}

/**
 * Mede a força de um PIN/senha. Não é decoração: o PIN é a única porta do cofre.
 *
 * Decisão de projeto: um PIN de 6 dígitos aleatório é ACEITO (é o que uma pessoa
 * idosa consegue digitar no celular sem errar), mas é sinalizado como "Razoável"
 * e nunca passa se for padrão óbvio. A proteção real vem da soma de:
 *   PBKDF2 com 210.000 iterações + AES-GCM + o dado nunca sair do aparelho.
 *
 * Retorna { score 0..4, label, ok, soNumeros }.
 */
export function pinStrength(pin) {
  const p = String(pin || '');

  // padrões que qualquer pessoa tentaria primeiro
  const obvio = p.length < 6
    || /^(\d)\1+$/.test(p)                       // 111111, 999999
    || /^(012345|123456|654321|000000)/.test(p)  // sequências
    || /^(19|20)\d{4}$/.test(p)                  // ano de 4 dígitos + 2
    || /^(0?[1-9]|[12]\d|3[01])(0?[1-9]|1[0-2])\d{2,4}$/.test(p); // dd/mm/aaaa

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;

  let score = 0;
  if (p.length >= 6) score++;
  if (p.length >= 8) score++;
  if (classes >= 2) score++;
  if (classes >= 3) score++;

  // PIN só de números não sobe além de "Razoável", mesmo longo
  const soNumeros = /^\d+$/.test(p);
  if (soNumeros) score = Math.min(score, 2);

  // comprimento curto aceitável sobe para "Razoável" (evita rejeitar o PIN sugerido)
  if (score === 1 && p.length >= 6) score = 2;

  if (obvio) score = 0;

  const labels = ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Forte'];
  return { score, label: labels[score], ok: score >= 2, soNumeros };
}
