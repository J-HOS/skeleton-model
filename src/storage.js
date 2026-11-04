/**
 * storage.js — the only module that touches persistent storage.
 *
 * What is stored: a short list of recently-viewed structure ids, e.g.
 * "Deltoid" or "Tibia_l_ZA", two display settings, and best study scores
 * (numbers per subject and region). Nothing else. No account, no personal data, no
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

import { LIMITS } from './config.js?v=410801c52c48';
import { isValidStructureId } from './security.js?v=410801c52c48';
import { STUDY_KINDS, STUDY_REGIONS } from './study.js?v=410801c52c48';

const RECENTS_KEY = 'skeletonModel.recentlyViewed.v1';
const DISCLAIMER_KEY = 'skeletonModel.disclaimerAcknowledged.v1';
// A display preference, not personal data: "light both sides on selection".
const BILATERAL_KEY = 'skeletonModel.bilateralSelection.v1';
// Study scores (2026-11-02): best Find-it result per subject and region, e.g.
// {"muscles:hand": {"best": 7, "total": 10}}. Numbers only - no answers, no
// timing, nothing that identifies the user.
const STUDY_KEY = 'skeletonModel.studyBest.v1';
// Built from study.js so the region list lives in one place (team review 2026-11-03).
const STUDY_KEY_RE = new RegExp(`^(${STUDY_KINDS.map((k) => k.id).join('|')}):(${STUDY_REGIONS.map((r) => r.id).join('|')})$`);

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

/** Best study scores, re-validated on read: { "kind:region": { best, total } }. */
export function getStudyBest() {
  let parsed;
  try {
    parsed = JSON.parse(readRaw(STUDY_KEY) || '{}');
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [key, v] of Object.entries(parsed)) {
    if (!STUDY_KEY_RE.test(key) || !v || typeof v !== 'object') continue;
    const { best, total } = v;
    if (Number.isInteger(best) && Number.isInteger(total) && total > 0 && total <= 500 && best >= 0 && best <= total) {
      out[key] = { best, total };
    }
  }
  return out;
}

/**
 * Is score/total better than prev.best/prev.total? Compared as fractions, so a
 * region whose number of questions changed (a fix adds or moves a structure)
 * never replaces a better best with a worse one (team review 2026-11-03: 3/4
 * was overwritten by 0/3). An equal fraction keeps the old record.
 */
export function isBetterScore(score, total, prev) {
  if (!prev) return true;
  return score * prev.total > prev.best * total;
}

/** Record a finished round; keeps the better score. Returns true if it is a new best. */
export function recordStudyScore(kind, region, score, total) {
  const key = `${kind}:${region}`;
  if (!STUDY_KEY_RE.test(key) || !Number.isInteger(score) || !Number.isInteger(total) || total <= 0 || score < 0 || score > total) return false;
  const all = getStudyBest();
  const prev = all[key];
  const better = isBetterScore(score, total, prev);
  if (better) {
    all[key] = { best: score, total };
    writeRaw(STUDY_KEY, JSON.stringify(all));
  }
  return better && Boolean(prev);
}

/** Wipe everything this app has stored. Wired to the "Clear data" button. */
export function clearAll() {
  memoryFallback.clear();
  try {
    if (globalThis.localStorage) {
      localStorage.removeItem(RECENTS_KEY);
      localStorage.removeItem(DISCLAIMER_KEY);
      localStorage.removeItem(BILATERAL_KEY);
      localStorage.removeItem(STUDY_KEY);
    }
  } catch {
    // nothing to do
  }
}
