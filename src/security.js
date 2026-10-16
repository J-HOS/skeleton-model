/**
 * security.js — the trust boundary of the app, in one readable file.
 *
 * Implements the measures in (C) security-architecture.md that apply to a
 * client-side build:
 *   §1 data integrity   -> verifyIntegrity()
 *   §5 input validation -> sanitizeQuery()
 *   §6 asset validation -> assertLooksLikeGLB()
 *
 * Design rule for this whole app: untrusted text never becomes HTML. There is
 * no HTML-escaping helper here because there is nowhere that concatenates
 * HTML — see dom.js, which creates nodes and sets textContent. Escaping is the
 * mitigation you need when you interpolate; not interpolating is stronger.
 */

import { LIMITS } from './config.js';

/**
 * SHA-256 of an ArrayBuffer, lowercase hex.
 * Requires a secure context (https:// or http://localhost). That is why the
 * app is served by serve.py rather than opened as a file:// page.
 */
export async function sha256Hex(buffer) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error(
      'Web Crypto is unavailable. Open the app through the local server ' +
        '(python serve.py) rather than by double-clicking index.html.'
    );
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify content against its build-time hash. Fails closed: any mismatch
 * throws and the caller shows an error screen, rather than rendering anatomy
 * that may have been altered on disk.
 */
export async function verifyIntegrity(buffer, expectedHex, label) {
  const actual = await sha256Hex(buffer);
  if (actual !== expectedHex) {
    throw new Error(
      `Integrity check failed for ${label}. Expected ${expectedHex}, got ${actual}. ` +
        'The data file changed since the last build — re-run build-data.py if that was intentional.'
    );
  }
  return actual;
}

/**
 * Control characters and bidirectional-override characters, which can make a
 * search result read differently than the text it actually contains.
 * Built from code points rather than literal characters so this line stays
 * readable and copy-paste safe.
 */
const CONTROL_AND_BIDI = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g'
);

/**
 * Clean a raw search box value before it is used anywhere.
 * - strips control and bidi characters
 * - collapses runs of whitespace
 * - caps length, so a pasted megabyte cannot drive a long scan
 *
 * The result is only ever compared with String.includes(); it is never
 * compiled into a RegExp, so there is no ReDoS surface.
 */
export function sanitizeQuery(raw) {
  return String(raw == null ? '' : raw)
    .replace(CONTROL_AND_BIDI, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.searchQueryChars);
}

/**
 * A structure id is our own identifier (a mesh name), not user prose. Keeping
 * the accepted set narrow means an id coming back from storage, or out of a
 * model file someone swapped in, can never be anything surprising by the time
 * it reaches a lookup or a DOM node.
 */
export function isValidStructureId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= LIMITS.storedIdChars &&
    // The character set actually used by the two mesh naming schemes and the
    // database, and nothing else. The asterisk appears in the rotator-cuff
    // group names; no character here has meaning in HTML, a URL path or a
    // file path, which is the point.
    // The colon appears in the Erector Spinae group names
    // ("ErectorSpinae:Longissimus(Thoracis,Cervicis,Capitis)").
    /^[A-Za-z0-9 ()&*',:._-]+$/.test(id)
  );
}

/**
 * Cheap structural check before handing bytes to the GLTF parser: a .glb
 * begins with the ASCII magic "glTF" followed by a little-endian version.
 * Rejecting here keeps obviously-wrong files (a renamed .zip, a truncated
 * download) out of the parser entirely.
 */
export function assertLooksLikeGLB(buffer, maxBytes = LIMITS.modelBytes) {
  if (!(buffer instanceof ArrayBuffer)) throw new Error('Not a binary file.');
  if (buffer.byteLength < 20) throw new Error('File is too small to be a .glb.');
  if (buffer.byteLength > maxBytes) {
    throw new Error(
      `File is ${(buffer.byteLength / 1048576).toFixed(0)} MB, over the ` +
        `${(maxBytes / 1048576).toFixed(0)} MB limit.`
    );
  }
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== 'glTF') throw new Error('Not a glTF binary file (bad magic bytes).');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Unsupported glTF version ${version}; expected 2.`);
  return true;
}

/**
 * fetch() with a STALL timeout and a same-origin guard.
 * Every asset path in this app is relative and resolved against our own
 * origin; this makes that a checked invariant rather than a convention.
 *
 * 2026-10-15 (team review P0): the timeout used to cover the WHOLE download,
 * so the 13 MB model (30 s cap) could never finish below ~3.6 Mbit/s - on
 * Slow-4G the error appeared at 42 s, and "Try again" restarted from zero.
 * It is now a stall guard: the timer is re-armed every time bytes arrive, so
 * a slow-but-moving download completes and only a truly hung one aborts.
 * onProgress(bytesReceived) is called as chunks arrive (buffer reads only).
 */
export async function fetchLocal(path, options = {}) {
  const { as = 'json', timeoutMs = LIMITS.fetchTimeoutMs, onProgress = null } = options;
  const url = new URL(path, document.baseURI);
  if (url.origin !== location.origin) {
    throw new Error(`Refusing to fetch off-origin asset: ${url.origin}`);
  }
  const controller = new AbortController();
  let timer = null;
  const rearm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  rearm();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-cache',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) {
      const error = new Error(`${res.status} ${res.statusText} for ${path}`);
      error.status = res.status;
      error.path = path;
      throw error;
    }
    if (as !== 'buffer') return await res.json();
    if (!res.body || !res.body.getReader) return await res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      rearm();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (onProgress) onProgress(received);
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    return out.buffer;
  } finally {
    clearTimeout(timer);
  }
}
