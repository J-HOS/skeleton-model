/**
 * dataset.js — load, verify and validate the anatomical content.
 *
 * The content is the product. If it is wrong, the app is worse than useless to
 * the medical professionals it is for, so it gets three checks before anything
 * renders:
 *   1. SHA-256 integrity against the build-time hash  (has the file changed?)
 *   2. Schema validation                              (is it shaped right?)
 *   3. Field validation per muscle                    (is any record hollow?)
 * Any failure throws and the app shows an error instead of partial anatomy.
 */

import { PATHS } from './config.js?v=7aa0c8ce5a6e';
import { fetchLocal, verifyIntegrity } from './security.js?v=7aa0c8ce5a6e';
import { buildMuscleIndex, buildLandmarkIndex, prettyName } from './anatomy.js?v=7aa0c8ce5a6e';

/** Every muscle record must carry these, per the CLAUDE.md data-structure rule. */
const REQUIRED_MUSCLE_FIELDS = ['name', 'section', 'origin', 'insertion', 'action', 'nerve_innervation'];

function validate(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Dataset is not an object.');
  if (!Array.isArray(raw.muscles)) throw new Error('Dataset is missing the muscles array.');
  if (!Array.isArray(raw.bony_landmarks)) throw new Error('Dataset is missing bony_landmarks.');

  const problems = [];
  const seen = new Set();
  raw.muscles.forEach((muscle, i) => {
    if (!muscle || typeof muscle !== 'object') {
      problems.push(`muscle[${i}] is not an object`);
      return;
    }
    for (const field of REQUIRED_MUSCLE_FIELDS) {
      const value = muscle[field];
      if (typeof value !== 'string' || value.trim() === '') {
        problems.push(`${muscle.name || `muscle[${i}]`} is missing "${field}"`);
      }
    }
    if (seen.has(muscle.name)) problems.push(`duplicate muscle name "${muscle.name}"`);
    seen.add(muscle.name);
  });

  if (problems.length) {
    throw new Error(
      `Dataset failed validation (${problems.length} problem(s)). First few: ` +
        problems.slice(0, 5).join('; ')
    );
  }
  return raw;
}

/**
 * Load the dataset, verify it, and return everything derived from it.
 * Called once at boot; the result is treated as immutable afterwards.
 */
export async function loadDataset() {
  const integrity = await fetchLocal(PATHS.integrity);
  const buffer = await fetchLocal(PATHS.dataset, { as: 'buffer' });

  await verifyIntegrity(buffer, integrity.sha256, 'anatomy.json');

  const raw = validate(JSON.parse(new TextDecoder().decode(buffer)));
  const muscleIndex = buildMuscleIndex(raw.muscles);
  const landmarks = buildLandmarkIndex(raw.bony_landmarks);

  // A collision here means two muscles share a normalised key. That is
  // expected for exactly one known pair (Abductor Digiti Minimi, hand vs
  // foot) and handled by exact-match-first, but a NEW collision means a mesh
  // name could silently resolve to the wrong muscle — worth seeing.
  if (muscleIndex.collisions.length) {
    console.info('Normalised-name collisions (exact match takes precedence):', muscleIndex.collisions);
  }

  return {
    metadata: raw.metadata || {},
    muscles: raw.muscles,
    muscleIndex,
    landmarks,
    integrity: integrity.sha256,
  };
}

/**
 * The searchable index: every muscle, plus every bone actually present in the
 * loaded model. Bones are added later by the viewer once geometry is in, since
 * until then we do not know which bones exist.
 */
export function buildSearchIndex(muscles) {
  return muscles.map((m) => ({
    id: m.name,                    // the raw name — it is the mesh-matching key
    name: prettyName(m.name),      // the readable name — display only
    subtitle: `${m.section} · Muscle`,
    kind: 'muscle',
    // Both spellings are searchable, so "pec major" and "PectoralisMajor"
    // both find the same record.
    haystack: `${prettyName(m.name)} ${m.name} ${m.section}`.toLowerCase(),
  }));
}
