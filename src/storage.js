/**
 * storage.js — the only module that touches persistent storage.
 *
 * What is stored: a short list of recently-viewed structure ids, e.g.
 * "Deltoid" or "Tibia_l_ZA". Nothing else. No account, no personal data, no
 * clinical or patient data, no free text the user typed. Per
 * (C) security-architecture.md §4 and the HIPAA note, keeping it to
 * non-identifying app state is what keeps this app outside the PHI boundary —
 * so if a future feature wants to store notes, that is a deliberate decision
 * with an encryption requirement, not an accident of adding a key here.
 *
 * Everything read back is re-validated. Data in localStorage is attacker- or
 * user-modifiable in principle, so it is treated as untrusted input on the way
 * in, exactly like a network response.
 */

import { LIMITS } from './config.js?v=8292cd6aa198';
import { isValidStructureId } from './security.js?v=8292cd6aa198';

const RECENTS_KEY = 'skeletonModel.recentlyViewed.v1';
const DISCLAIMER_KEY = 'skeletonModel.disclaimerAcknowledged.v1';
// A display preference, not personal data: "light both sides on selection".
const BILATERAL_KEY = 'skeletonModel.bilateralSelection.v1';

/**
 * localStorage throws in some contexts (Safari private browsing, disabled
 * cookies, sandboxed iframes). Persistence is a convenience here, never a
 * requirement, so every access degrades to an in-memory fallback rather than
 * breaking the app.
 */
const memoryFallback = new Map();

function readRaw(key) {
  try {
    return globalThis.localStorage ? localStorage.getItem(key) : memoryFallback.get(key) ?? null;
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function writeRaw(key, value) {
  memoryFallback.set(key, value);
  try {
    if (globalThis.localStorage) localStorage.setItem(key, value);
  } catch {
    // Quota exceeded or storage disabled — the in-memory copy still works
    // for this session. Not worth surfacing to the user.
  }
}

/** Recently viewed structure ids, newest first. Always a valid array. */
export function getRecents() {
  let parsed;
  try {
    parsed = JSON.parse(readRaw(RECENTS_KEY) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidStructureId).slice(0, LIMITS.recentItems);
}

/** Record a structure as viewed. Invalid ids are ignored, not stored. */
export function pushRecent(id) {
  if (!isValidStructureId(id)) return;
  const next = [id, ...getRecents().filter((x) => x !== id)].slice(0, LIMITS.recentItems);
  writeRaw(RECENTS_KEY, JSON.stringify(next));
}

export function hasAcknowledgedDisclaimer() {
  return readRaw(DISCLAIMER_KEY) === 'true';
}

export function acknowledgeDisclaimer() {
  writeRaw(DISCLAIMER_KEY, 'true');
}

/** Bilateral selection preference. Anything but the exact string 'true' reads as off. */
export function getBilateral() {
  return readRaw(BILATERAL_KEY) === 'true';
}

export function setBilateral(enabled) {
  writeRaw(BILATERAL_KEY, enabled ? 'true' : 'false');
}

/** Wipe everything this app has stored. Wired to the "Clear data" button. */
export function clearAll() {
  memoryFallback.clear();
  try {
    if (globalThis.localStorage) {
      localStorage.removeItem(RECENTS_KEY);
      localStorage.removeItem(DISCLAIMER_KEY);
      localStorage.removeItem(BILATERAL_KEY);
    }
  } catch {
    // nothing to do
  }
}
