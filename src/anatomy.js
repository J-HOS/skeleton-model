/**
 * anatomy.js — pure domain logic. No DOM, no three.js, no I/O.
 *
 * Turns a raw mesh name from a .glb into an anatomical record. Everything here
 * is a pure function of its inputs, which is why it can be unit-tested against
 * every real mesh name without a browser (see test/run-tests.mjs).
 *
 * MESH NAMING (rebuilt 2026-07-27)
 * Every bone now comes from Z-Anatomy and follows one regular scheme:
 *     <Bone_name>[_l|_r]_ZA      e.g. Femur_l_ZA, Vertebra_C4_ZA, First_rib_r_ZA
 * The previous build mixed Z-Anatomy meshes with 13 opaque BodyParts3D ids
 * (FJ####) that had to be identified by hand. Two of those were misidentified —
 * a tibia was labelled and positioned as a femur — which is what put the leg
 * bones a whole segment out of place. Sourcing every bone from one dataset
 * removed that entire class of error, and the FJ_BONES lookup table with it.
 *
 * Muscle meshes carry their database name and no _ZA suffix, so classifyBone()
 * returns null for them and they fall through to the muscle lookup — a clean,
 * collision-free split between the two content types.
 */

/* -------------------------------------------------------------- helpers -- */

const ORDINAL = {
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th',
};

const RIB_NUMBER = {
  First: '1st', Second: '2nd', Third: '3rd', Fourth: '4th', Fifth: '5th',
  Sixth: '6th', Seventh: '7th', Eighth: '8th', Ninth: '9th', Tenth: '10th',
  Eleventh: '11th', Twelfth: '12th',
};

function sideSuffix(side) {
  return side ? ` (${side === 'left' ? 'Left' : 'Right'})` : '';
}

/**
 * Named bones, keyed by their mesh name with the side and _ZA suffix removed.
 * Value: [display, region, type, landmarkKey]. The landmark key indexes the
 * verified Section 11 bony-landmark cards; null means no card exists yet.
 */
const BONES = {
  // ---- skull -------------------------------------------------------------
  Frontal_bone: ['Frontal bone', 'Head', 'Cranial bone', null],
  Parietal_bone: ['Parietal bone', 'Head', 'Cranial bone', null],
  Temporal_bone: ['Temporal bone', 'Head', 'Cranial bone', null],
  Occipital_bone: ['Occipital bone', 'Head', 'Cranial bone', null],
  Sphenoid_bone: ['Sphenoid bone', 'Head', 'Cranial bone', null],
  Ethmoid_bone: ['Ethmoid bone', 'Head', 'Cranial bone', null],
  Nasal_bone: ['Nasal bone', 'Head', 'Facial bone', null],
  Lacrimal_bone: ['Lacrimal bone', 'Head', 'Facial bone', null],
  Maxilla: ['Maxilla', 'Head', 'Facial bone', null],
  Palatine_bone: ['Palatine bone', 'Head', 'Facial bone', null],
  Zygomatic_bone: ['Zygomatic bone', 'Head', 'Facial bone', null],
  Vomer: ['Vomer', 'Head', 'Facial bone', null],
  Mandible: ['Mandible', 'Head', 'Facial bone', null],
  Inferior_nasal_concha_bone: ['Inferior nasal concha', 'Head', 'Facial bone', null],
  Anterior_cells_of_ethmoid_bone: ['Anterior ethmoidal air cells', 'Head', 'Paranasal sinus', null],
  Middle_cells_of_ethmoid_bone: ['Middle ethmoidal air cells', 'Head', 'Paranasal sinus', null],
  Posterior_cells_of_ethmoid_bone: ['Posterior ethmoidal air cells', 'Head', 'Paranasal sinus', null],
  Sinus_of_frontal_bone: ['Frontal sinus', 'Head', 'Paranasal sinus', null],
  Sinus_of_sphenoid_bone: ['Sphenoidal sinus', 'Head', 'Paranasal sinus', null],

  // ---- ear and hyoid -----------------------------------------------------
  Malleus: ['Malleus', 'Middle ear', 'Auditory ossicle', null],
  Incus: ['Incus', 'Middle ear', 'Auditory ossicle', null],
  Stapes: ['Stapes', 'Middle ear', 'Auditory ossicle', null],
  Hyoid_bone: ['Hyoid bone', 'Neck', 'Unpaired U-shaped bone', null],

  // ---- spine and pelvis --------------------------------------------------
  Atlas_C1: ['Atlas (C1)', 'Neck', 'Cervical vertebra', 'atlasaxis'],
  Axis_C2: ['Axis (C2)', 'Neck', 'Cervical vertebra', 'atlasaxis'],
  Sacrum: ['Sacrum', 'Pelvis', 'Fused vertebrae', 'sacrum'],
  Coccyx: ['Coccyx', 'Pelvis', 'Fused vertebrae', 'sacrum'],
  Hip_bone: ['Hip bone (os coxae)', 'Pelvis', 'Irregular bone', 'hip'],

  // ---- thorax ------------------------------------------------------------
  Manubrium_of_sternum: ['Manubrium of sternum', 'Thorax', 'Flat bone', null],
  Body_of_sternum: ['Body of sternum', 'Thorax', 'Flat bone', null],
  Xiphoid_process: ['Xiphoid process', 'Thorax', 'Flat bone', null],

  // ---- upper limb --------------------------------------------------------
  Clavicle: ['Clavicle', 'Shoulder girdle', 'Long bone', 'clavicle'],
  Scapula: ['Scapula', 'Shoulder girdle', 'Flat bone', 'scapula'],
  Humerus: ['Humerus', 'Upper limb', 'Long bone', 'humerus'],
  Radius: ['Radius', 'Upper limb', 'Long bone', 'radius'],
  Ulna: ['Ulna', 'Upper limb', 'Long bone', 'ulna'],
  Scaphoid_bone: ['Scaphoid', 'Wrist', 'Carpal bone', 'hand'],
  Lunate_bone: ['Lunate', 'Wrist', 'Carpal bone', 'hand'],
  Triquetrum_bone: ['Triquetrum', 'Wrist', 'Carpal bone', 'hand'],
  Pisiform_bone: ['Pisiform', 'Wrist', 'Carpal bone', 'hand'],
  Trapezium_bone: ['Trapezium', 'Wrist', 'Carpal bone', 'hand'],
  Trapezoid_bone: ['Trapezoid', 'Wrist', 'Carpal bone', 'hand'],
  Capitate_bone: ['Capitate', 'Wrist', 'Carpal bone', 'hand'],
  Hamate_bone: ['Hamate', 'Wrist', 'Carpal bone', 'hand'],

  // ---- lower limb --------------------------------------------------------
  Femur: ['Femur', 'Lower limb', 'Long bone', 'femur'],
  Patella: ['Patella', 'Lower limb', 'Sesamoid bone', 'patella'],
  Tibia: ['Tibia', 'Lower limb', 'Long bone', 'tibia'],
  Fibula: ['Fibula', 'Lower limb', 'Long bone', 'fibula'],
  Talus: ['Talus', 'Foot', 'Tarsal bone', 'foot'],
  Calcaneus: ['Calcaneus', 'Foot', 'Tarsal bone', 'foot'],
  Navicular_bone: ['Navicular', 'Foot', 'Tarsal bone', 'foot'],
  Cuboid_bone: ['Cuboid', 'Foot', 'Tarsal bone', 'foot'],
  Medial_cuneiform_bone: ['Medial cuneiform', 'Foot', 'Tarsal bone', 'foot'],
  Intermediate_cuneiform_bone: ['Intermediate cuneiform', 'Foot', 'Tarsal bone', 'foot'],
  Lateral_cuneiform_bone: ['Lateral cuneiform', 'Foot', 'Tarsal bone', 'foot'],
  Sesamoid_bones_of_foot: ['Sesamoid bones of foot', 'Foot', 'Sesamoid bones', 'foot'],
};

/** Rules for the regularly-numbered bones, tried after the table. */
const PATTERNS = [
  // Vertebra_C4 / Vertebra_T10 / Vertebra_L3
  [/^Vertebra_([CTL])(\d{1,2})$/, (m) => {
    const region = { C: 'Neck', T: 'Thorax', L: 'Lumbar' }[m[1]];
    const type = { C: 'Cervical', T: 'Thoracic', L: 'Lumbar' }[m[1]] + ' vertebra';
    const landmark = { C: 'cervical', T: 'thoracic', L: 'lumbar' }[m[1]];
    return [`${m[1]}${m[2]} Vertebra`, region, type, landmark];
  }],
  // First_rib .. Twelfth_rib
  [/^(\w+)_rib$/, (m) => {
    const n = RIB_NUMBER[m[1]];
    return n ? [`${n} Rib`, 'Thorax', 'Rib', 'thoracic'] : null;
  }],
  // First_metacarpal_bone / Third_metatarsal_bone
  [/^(First|Second|Third|Fourth|Fifth)_(metacarpal|metatarsal)_bone$/, (m) => {
    const n = ORDINAL[m[1].toLowerCase()];
    return m[2] === 'metacarpal'
      ? [`${n} Metacarpal`, 'Hand', 'Metacarpal bone', 'hand']
      : [`${n} Metatarsal`, 'Foot', 'Metatarsal bone', 'foot'];
  }],
  // Proximal_phalanx_of_third_finger_of_hand  (Z-Anatomy calls toes "fingers of foot")
  [/^(Proximal|Middle|Distal)_phalanx_of_(first|second|third|fourth|fifth)_finger_of_(hand|foot)$/, (m) => {
    const digit = m[3] === 'hand' ? 'finger' : 'toe';
    return [
      `${m[1]} phalanx (${ORDINAL[m[2]]} ${digit})`,
      m[3] === 'hand' ? 'Hand' : 'Foot',
      'Phalanx',
      m[3] === 'hand' ? 'hand' : 'foot',
    ];
  }],
  // Upper_first_molar_tooth / Lower_canine / Upper_lateral_incisor
  [/^(Upper|Lower)_(.+?)(?:_tooth)?$/, (m) => {
    const arch = m[1] === 'Upper' ? 'Upper' : 'Lower';
    const name = m[2].replace(/_/g, ' ');
    if (!/incisor|canine|premolar|molar/.test(name)) return null;
    return [`${arch} ${name}`, 'Head', 'Tooth', null];
  }],
];

/**
 * Classify a bone mesh name.
 * @returns {{display:string, region:string, type:string, landmark:string|null}|null}
 *   null means "not a bone mesh" — the caller should try the muscle database.
 */
export function classifyBone(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  if (!rawName.endsWith('_ZA')) return null;

  let core = rawName.slice(0, -3);
  let side = null;
  const sideMatch = core.match(/_(l|r)$/);
  if (sideMatch) {
    side = sideMatch[1] === 'l' ? 'left' : 'right';
    core = core.slice(0, -2);
  }

  let entry = BONES[core];
  if (!entry) {
    for (const [pattern, build] of PATTERNS) {
      const m = core.match(pattern);
      if (!m) continue;
      const built = build(m);
      if (built) { entry = built; break; }
    }
  }
  if (!entry) return null; // unknown bone: caller shows it honestly rather than guessing

  const [display, region, type, landmark] = entry;
  return { display: display + sideSuffix(side), region, type, landmark };
}

/* ------------------------------------------------------ muscle matching -- */

/** Normalised lookup key: lowercase alphanumerics only. */
export function normKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A looser key that also drops filler words a mesh exporter adds but the
 * database does not use, so "Dorsal_interossei_muscles_of_foot" and the
 * database's "Dorsal Interossei (Foot)" both become "dorsalinterosseifoot".
 * Used only as a last resort, after exact and normalised matching, because
 * dropping words can only make two names more likely to collide.
 */
const FILLER = /\b(muscles?|of|the|bone|group|part)\b/g;
export function looseKey(s) {
  return String(s || '')
    .replace(/[_.-]+/g, ' ')
    .toLowerCase()
    .replace(FILLER, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Database names are concatenated identifiers ("PectoralisMajor(clavicularhead)")
 * because the name doubles as a mesh-matching key. That is fine as a key and
 * wrong as a label — a physiotherapist reading "Deltoid(anteriorhead)" sees a
 * data artefact, not a muscle. This restores the spacing for display only; the
 * stored name is never modified, so matching is unaffected.
 */
const MODIFIER_WORDS = [
  'anterior', 'posterior', 'superior', 'inferior', 'medial', 'lateral',
  'clavicular', 'sternal', 'costal', 'scapular', 'vertebral',
  'upper', 'middle', 'lower', 'long', 'short', 'deep', 'superficial',
  'major', 'minor', 'magnus', 'longus', 'brevis', 'oblique',
  'head', 'heads', 'part', 'portion', 'group', 'muscle', 'rotator', 'cuff',
  'hand', 'foot', 'and',
].sort((a, b) => b.length - a.length); // longest first so greedy matching wins

function segment(run) {
  const words = [];
  let rest = run;
  while (rest.length) {
    const word = MODIFIER_WORDS.find((w) => rest.startsWith(w));
    if (!word) return null; // unknown fragment — leave the original alone
    words.push(word);
    rest = rest.slice(word.length);
  }
  return words.join(' ');
}

export function prettyName(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\(([a-z]+)\)/g, (whole, run) => {
      const split = segment(run);
      return split ? `(${split})` : whole;
    })
    .replace(/&/g, ' & ')
    .replace(/\s+/g, ' ')
    .replace(/\s+\)/g, ')')
    .trim();
}

/** Split a trailing laterality marker off a mesh name. */
export function splitLaterality(raw) {
  let m = raw.match(/^(.*?)[._ -](left|right)$/i);
  if (!m) m = raw.match(/^(.*?)\.(l|r)$/i);
  if (!m) return { base: raw, side: null };
  return { base: m[1], side: /^l/i.test(m[2]) ? 'left' : 'right' };
}

/* ------------------------------------------------- bilateral selection -- */

/**
 * The id of the same structure on the other side of the body, or null for a
 * midline structure (Diaphragm, vertebrae, sternum...).
 *
 * Two naming conventions are live in the model and both are handled:
 *   muscles  BicepsBrachii_left  <->  BicepsBrachii_right
 *   bones    Femur_l_ZA          <->  Femur_r_ZA
 * Pure string work: whether the mirror actually exists in the scene is the
 * caller's question (see selectionGroup).
 */
export function mirrorStructureId(id) {
  if (!id || typeof id !== 'string') return null;
  let m = id.match(/^(.+)_(l|r)_ZA$/);
  if (m) return `${m[1]}_${m[2] === 'l' ? 'r' : 'l'}_ZA`;
  m = id.match(/^(.+)_(left|right)$/);
  if (m) return `${m[1]}_${m[2] === 'left' ? 'right' : 'left'}`;
  return null;
}

/**
 * Which structure ids a selection of `id` should light up.
 *
 * bilateral=false: just the structure tapped.
 * bilateral=true:  that structure and its partner on the other side, if the
 *                  model has one.
 *
 * Either way, an id that names no mesh but has sided meshes (search passes a
 * muscle's database name, "BicepsBrachii", while the model only contains
 * BicepsBrachii_left / _right) selects every side present. Found 2026-10-09:
 * before this, picking any muscle from search highlighted nothing, because
 * the muscle layer went two-sided on 2026-08-01 and search was never updated.
 * Search carries no side, so both is the only honest answer there.
 *
 * The suffix rule alone is not enough: the four rotator-cuff records are
 * named "Supraspinatus (*rotator cuff muscle group)" while their meshes are
 * "Supraspinatus(*rotatorcuffmusclegroup)_left". So `aliases` (from
 * recordAliases) maps a database name to the scene ids that resolve to it,
 * through the same matcher a tap uses.
 *
 * @param {string} id
 * @param {Iterable<string>} sceneIds  every structure id in the scene
 * @param {boolean} bilateral
 * @param {Map<string,string[]>} [aliases]
 * @returns {Set<string>}
 */
export function selectionGroup(id, sceneIds, bilateral, aliases) {
  const out = new Set();
  if (!id) return out;
  const present = sceneIds instanceof Set ? sceneIds : new Set(sceneIds);
  if (present.has(id)) {
    out.add(id);
    const mirror = bilateral ? mirrorStructureId(id) : null;
    if (mirror && present.has(mirror)) out.add(mirror);
    return out;
  }
  for (const alias of aliases?.get(id) || []) {
    if (present.has(alias)) out.add(alias);
  }
  for (const sided of [`${id}_left`, `${id}_right`, `${id}_l_ZA`, `${id}_r_ZA`]) {
    if (present.has(sided)) out.add(sided);
  }
  // Nothing in the scene matches (a structure with no mesh): return an EMPTY
  // set (2026-10-16, review N2). Keeping the id made the selection non-empty,
  // so every other mesh dimmed although nothing was lit.
  return out;
}

/**
 * Database name -> the scene structure ids that resolve to that record, via
 * findMuscleRecord (the matcher a tap goes through). Used by selectionGroup
 * so a search pick finds its meshes however differently they are spelled.
 */
export function recordAliases(sceneIds, muscleIndex) {
  const out = new Map();
  for (const sid of sceneIds) {
    const hit = findMuscleRecord(muscleIndex, sid);
    if (!hit) continue;
    const list = out.get(hit.record.name) || [];
    list.push(sid);
    out.set(hit.record.name, list);
  }
  return out;
}

/**
 * Build the muscle lookup.
 *
 * Three maps on purpose, tried in order of decreasing strictness. Exact name
 * first because normalising strips spaces and punctuation, and one real pair
 * collides once normalised — "AbductorDigitiMinimi" (hand, section 4) and
 * "Abductor Digiti Minimi" (foot, section 10) both become
 * "abductordigitiminimi". Exact-first means search, which always passes a
 * literal database name, is never ambiguous.
 */
export function buildMuscleIndex(muscles) {
  const exact = new Map();
  const fuzzy = new Map();
  const loose = new Map();
  const collisions = [];
  for (const muscle of muscles) {
    exact.set(muscle.name, muscle);
    const key = normKey(muscle.name);
    if (fuzzy.has(key)) collisions.push(muscle.name);
    else fuzzy.set(key, muscle);
    const lkey = looseKey(muscle.name);
    if (!loose.has(lkey)) loose.set(lkey, muscle);
  }
  return { exact, fuzzy, loose, collisions };
}

/**
 * Find the muscle record for a mesh name.
 * @returns {{record: object, side: string|null}|null}
 */
export function findMuscleRecord(index, rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  let record = index.exact.get(rawName) || index.fuzzy.get(normKey(rawName));
  if (record) return { record, side: null };

  const { base, side } = splitLaterality(rawName);
  if (side) {
    record = index.exact.get(base) || index.fuzzy.get(normKey(base));
    if (record) return { record, side };
  }

  record = index.loose && index.loose.get(looseKey(base));
  if (record) return { record, side };
  return null;
}

/**
 * Does this name name something the app has content for?
 *
 * Exists because a mesh's own name is NOT reliably the structure's name. A
 * glTF mesh with more than one material slot becomes a Group in three.js whose
 * child meshes inherit the Blender MESH DATABLOCK name, not the object name —
 * so `Parietal_bone_r_ZA` (a node) contains meshes called `Parietal_boner`,
 * and `BicepsBrachii` contains `FJ1478`. 241 of the 365 structures in
 * skeleton_v2.glb are multi-slot, because Z-Anatomy models sutures, cartilage
 * and dentine as separate materials on the same bone.
 *
 * Callers use this to walk up from a mesh to the nearest ancestor that DOES
 * name a real structure — see Viewer._structureIdFor(). Found 2026-08-01:
 * before that walk existed, 550 of the app's 674 meshes resolved to nothing,
 * so 231 of 238 bones could not be tapped at all and 10 multi-part muscles
 * (BicepsBrachii, TricepsBrachii, Rhomboids...) fell through classifyLayer()'s
 * default and rendered bone-coloured in the skeleton layer.
 */
export function resolvesToContent(name, muscleIndex) {
  if (classifyBone(name)) return true;
  return Boolean(muscleIndex && findMuscleRecord(muscleIndex, name));
}

/**
 * The kind of bone surface a material slot represents, or null.
 *
 * Z-Anatomy splits each bone across several materials — `Bone-2.003`,
 * `Suture-4.003`, `Cartilage.005`, `Teeth-roots.003`, `Dentine.003`. That is a
 * real anatomical distinction the source data already carries, and the app was
 * throwing it away by painting every slot COLORS.bone. Reducing the name to its
 * leading token is enough to recover it: Blender's `-N` variant suffixes and
 * `.NNN` duplicate suffixes both fall away.
 */
export function boneSurfaceKey(materialName) {
  const token = String(materialName || '').split(/[-.]/)[0].trim().toLowerCase();
  return token || null;
}

/**
 * A stable number in [0,1) derived from a name. FNV-1a, chosen because it is
 * six lines, has no dependencies and gives the same answer every run — the
 * colours below must not shimmer between sessions.
 */
export function nameHash(name) {
  let h = 2166136261;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Nudge a colour lighter or darker by a fixed amount, deterministically per
 * name. Neighbouring muscles in the SAME anatomical section previously shared
 * one exact colour, so a group like the three vastus heads or the hamstrings
 * read as a single undifferentiated mass — the ten section colours separate
 * regions from each other but not muscles within a region. A small per-muscle
 * lightness offset gives every belly its own shade, so the seam between two
 * of them is visible as a step in tone rather than only as geometry.
 *
 * Lightness only, never hue: shifting hue would break the "the whole layer
 * still reads as muscle" property that MUSCLE_SECTION_COLORS is built around.
 */
export function varyLightness(hex, name, amount) {
  return scaleChannels(hex, 1 + (nameHash(name) * 2 - 1) * amount);
}

/**
 * Multiply every channel of a packed RGB colour by k, clamped to 0..255.
 *
 * Split out of varyLightness (2026-08-02) because the dev panel needs the same
 * operation driven by a slider rather than by a name hash — dialling the suture
 * tone up and down is how you find out whether BONE_SURFACE_COLORS.suture is
 * actually right, and those four values have never been judged in the running
 * app. Scaling all three channels together moves lightness while leaving hue
 * and saturation where they are, which is the property both callers want.
 */
export function scaleChannels(hex, k) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  const r = clamp((hex >> 16) & 0xff);
  const g = clamp((hex >> 8) & 0xff);
  const b = clamp(hex & 0xff);
  return (r << 16) | (g << 8) | b;
}

/**
 * Where each vertex sits along a mesh's own long axis, as 0..1 from one end to
 * the other. Plain arithmetic on a flat [x,y,z,x,y,z,...] array — no three.js,
 * so the geometry reasoning is testable in Node like everything else here.
 *
 * This is the cheap half of attachment-point tinting. The database records a
 * muscle's origin and insertion as TEXT; nothing marks which vertices belong to
 * which end, and annotating 126 muscles by hand is a large piece of work to
 * commit to before knowing whether the effect is even worth having. A muscle is
 * a long thing with attachments at its two extremes, so "distance along the long
 * axis" approximates "how close to an attachment" well enough to judge the idea.
 *
 * The axis comes from the two-point diameter heuristic: farthest vertex from
 * the centroid, then farthest vertex from that one. It is the standard cheap
 * stand-in for a principal-component axis, it is O(n) with no matrix maths, and
 * on an elongated body it lands on the long axis reliably. It does NOT follow a
 * curved muscle around its bend, and it cannot tell origin from insertion —
 * both are real limits of the approximation, not bugs, and both are reasons the
 * annotated version may still be needed if the effect proves worth keeping.
 *
 * Degenerate input (no vertices, or every vertex coincident) returns 0.5
 * everywhere, i.e. "all belly, no ends" — the neutral answer, so a malformed
 * mesh renders untinted rather than banded arbitrarily.
 */
export function axialParameter(positions) {
  const count = Math.floor((positions?.length ?? 0) / 3);
  const out = new Float32Array(count);
  if (count === 0) return out;

  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += positions[i * 3];
    cy += positions[i * 3 + 1];
    cz += positions[i * 3 + 2];
  }
  cx /= count; cy /= count; cz /= count;

  const farthestFrom = (px, py, pz) => {
    let best = -1;
    let index = 0;
    for (let i = 0; i < count; i++) {
      const dx = positions[i * 3] - px;
      const dy = positions[i * 3 + 1] - py;
      const dz = positions[i * 3 + 2] - pz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > best) { best = d; index = i; }
    }
    return index;
  };

  const a = farthestFrom(cx, cy, cz);
  const b = farthestFrom(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]);

  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  let vx = positions[b * 3] - ax;
  let vy = positions[b * 3 + 1] - ay;
  let vz = positions[b * 3 + 2] - az;
  const lengthSq = vx * vx + vy * vy + vz * vz;
  if (!(lengthSq > 0)) {
    out.fill(0.5);
    return out;
  }

  // Projections are rescaled to the range actually observed rather than
  // assumed to be [0,1]: a and b are extreme points but nothing guarantees
  // they bound every projection exactly, and a t that quietly ran past 1 would
  // put a false attachment band wherever it clipped.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < count; i++) {
    const t = ((positions[i * 3] - ax) * vx
      + (positions[i * 3 + 1] - ay) * vy
      + (positions[i * 3 + 2] - az) * vz) / lengthSq;
    out[i] = t;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const span = max - min;
  if (!(span > 0)) {
    out.fill(0.5);
    return out;
  }
  for (let i = 0; i < count; i++) out[i] = (out[i] - min) / span;
  return out;
}

/**
 * How strongly a vertex should read as attachment rather than belly, 0..1.
 *
 * `span` is the fraction of the muscle's length at EACH end that counts as
 * attachment. The smoothstep matters more than it looks: a linear ramp leaves a
 * visible hard edge where the band starts, which reads as a rendering seam
 * rather than as tendon becoming muscle.
 */
export function attachmentWeight(t, span) {
  if (!(span > 0)) return 0;
  const distanceFromEnd = Math.min(t, 1 - t);
  const e = Math.max(0, Math.min(1, 1 - distanceFromEnd / span));
  return e * e * (3 - 2 * e);
}

/**
 * How much a muscle narrows into the ends attachmentWeight() would tint:
 * mean radius about its long axis inside the end bands, over mean radius at
 * mid-belly. Below 1 converges, above 1 gets wider toward its ends.
 *
 * This exists because of what the renders on 2026-08-31 showed. The tint reads
 * correctly on biceps (0.46) and gastrocnemius (0.62) and reads as bleaching on
 * pectoralis major (0.88) — and the reason is not how MUCH surface gets washed,
 * which was the first explanation offered and was measured false (sheet muscles
 * 15.8%, fusiform 16.4% — no difference). It is that a tendon reads as a tendon
 * only because the belly visibly converges into it. Pale at an end that stays
 * wide has nothing to be the tendon OF, so it reads as a fading model instead.
 *
 * At the shipped span, 57 of 127 muscles sit above 0.8 and 33 above 1.0 — the
 * worst are the long digital muscles, which split into several tendons and so
 * are genuinely wider at the end being paled. On a reference clinicians check,
 * pale where no tendon exists is a content error drawn in geometry, which is
 * why this gate is a correctness measure and not a taste one.
 *
 * The ratio is span-dependent and those counts move with it — measured over the
 * 0.28 span that shipped before, the same model gives 47 and 30. So the caller
 * must measure at the span it is about to tint with, not at some fixed
 * reference, or it gates on a band it is not painting.
 *
 * The axis is recovered from `axial` rather than recomputed: t is the normalised
 * projection onto the axis axialParameter() actually chose, so regressing
 * position on t returns that same line. Deriving it a second time by its own
 * route would risk gating on a different axis than the one being tinted.
 *
 * Returns Infinity for degenerate input, so a malformed mesh fails closed —
 * untinted — rather than being tinted on a meaningless ratio.
 */
export function axialTaper(positions, axial, span) {
  const count = Math.floor((positions?.length ?? 0) / 3);
  if (count === 0 || !axial || axial.length !== count || !(span > 0)) return Infinity;

  let sT = 0, sTT = 0, sX = 0, sY = 0, sZ = 0, sTX = 0, sTY = 0, sTZ = 0;
  for (let i = 0; i < count; i++) {
    const t = axial[i];
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    sT += t; sTT += t * t; sX += x; sY += y; sZ += z;
    sTX += t * x; sTY += t * y; sTZ += t * z;
  }
  const den = count * sTT - sT * sT;
  if (!(Math.abs(den) > 1e-12)) return Infinity;

  const dx = (count * sTX - sT * sX) / den;
  const dy = (count * sTY - sT * sY) / den;
  const dz = (count * sTZ - sT * sZ) / den;
  const ox = (sX - dx * sT) / count;
  const oy = (sY - dy * sT) / count;
  const oz = (sZ - dz * sT) / count;

  // The end band is measured over the inner 60% of the tinted span. The tint
  // fades to nothing exactly at t=0 and t=1, so sampling the whole span would
  // average in the extreme tip, where a mesh tapers to a point on almost
  // everything and the ratio stops discriminating.
  const edge = span * 0.6;
  let endR = 0, endN = 0, midR = 0, midN = 0;
  for (let i = 0; i < count; i++) {
    const t = axial[i];
    const r = Math.hypot(
      positions[i * 3] - (ox + dx * t),
      positions[i * 3 + 1] - (oy + dy * t),
      positions[i * 3 + 2] - (oz + dz * t)
    );
    if (t < edge || t > 1 - edge) { endR += r; endN++; }
    else if (t > 0.4 && t < 0.6) { midR += r; midN++; }
  }

  if (!endN || !midN) return Infinity;
  const mid = midR / midN;
  if (!(mid > 0)) return Infinity;
  return (endR / endN) / mid;
}

/**
 * Assign a mesh to a display layer.
 *
 * Identity-based, not keyword-based: a mesh is a bone if classifyBone() names
 * it and a muscle if the database knows it. The earlier keyword list mis-sorted
 * any muscle whose name happened to contain no keyword — Iliacus, Supinator and
 * Popliteus all landed in the skeleton layer and rendered bone-coloured.
 * Keywords survive only for the three layers we have no data for yet, so a
 * future atlas import still sorts sensibly.
 */
export function classifyLayer(name, muscleIndex) {
  // Identity checks first, keyword guesses second. classifyBone()/
  // findMuscleRecord() know the real content; the nerve/vessel/ligament
  // regexes below are a fallback for layers with no structured data yet, and
  // a fallback must never outrank an identity match. It used to run the
  // other way round, which misclassified TensorFasciaeLatae — a real,
  // database-known muscle — into the ligaments layer purely because its name
  // contains "fascia". That mesh then ignored the muscle layer toggle
  // entirely (2026-07-31, reported as "muscles showing with only skeleton
  // selected"). Same failure class the mesh-name keyword bug already fixed
  // for classifyLayer's older version — see the note above.
  if (classifyBone(name)) return 'skeleton';
  if (muscleIndex && findMuscleRecord(muscleIndex, name)) return 'muscle';

  const n = String(name || '').toLowerCase();
  if (/(nerve|nervi|plexus|ganglion)/.test(n)) return 'nerves';
  if (/(artery|arteria|vein|vena|venous|vessel|aorta|capillar)/.test(n)) return 'vessels';
  if (/(ligament|ligamentum|tendon|fascia|retinacul|aponeur)/.test(n)) return 'ligaments';
  return 'skeleton';
}

/* ---------------------------------------------------------- landmarks --- */

const LANDMARK_KEYWORDS = [
  ['clavicle', 'Clavicle'], ['scapula', 'Scapula'], ['humerus', 'Humerus'],
  ['radius', 'Radius'], ['ulna', 'Ulna'], ['hand', 'Hand'], ['cervical', 'Cervical'],
  ['atlasaxis', 'Atlas'], ['thoracic', 'Thoracic'], ['lumbar', 'Lumbar'],
  ['hip', 'Ilium'], ['sacrum', 'Sacrum'], ['femur', 'Femur'], ['tibia', 'Tibia'],
  ['fibula', 'Fibula'], ['patella', 'Patella'], ['foot', 'Foot'],
];

export function buildLandmarkIndex(landmarkCards) {
  const index = {};
  for (const card of landmarkCards) {
    const title = String(card.title || '');
    for (const [key, word] of LANDMARK_KEYWORDS) {
      if (title.startsWith(`Bony Landmarks of the ${word}`)) index[key] = card.content;
    }
  }
  return index;
}

/**
 * Parse a landmark card body into renderable rows.
 * Lines look like "a Acromion"; bare lines ("Ilium") are sub-headers. The
 * card's own title line is dropped since it is already the panel heading.
 */
export function parseLandmarkCard(content) {
  const lines = String(content || '').split('\n');
  lines.shift();
  return lines
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const m = line.match(/^([a-z]{1,2}) (.+)$/);
      return m ? { kind: 'item', key: m[1], text: m[2] } : { kind: 'heading', text: line };
    });
}

/* ------------------------------------------------------------ depth view -- */

/**
 * Validate the measured-layers file and return Map<structureId, layer>.
 * Layers are small positive integers; ids are bounded strings. Anything else
 * is rejected (returns null) rather than half-applied, so a damaged file
 * turns the depth view off instead of hiding the wrong muscles.
 */
export function parseLayerMap(raw, maxLayer = 20) {
  if (!raw || typeof raw !== 'object' || !raw.layers || typeof raw.layers !== 'object') return null;
  const map = new Map();
  for (const [id, n] of Object.entries(raw.layers)) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) return null;
    if (!Number.isInteger(n) || n < 1 || n > maxLayer) return null;
    map.set(id, n);
  }
  return map.size ? map : null;
}

/** Deepest layer in the map (0 for an empty or missing map). */
export function deepestLayer(map) {
  let max = 0;
  if (map) for (const n of map.values()) if (n > max) max = n;
  return max;
}

/**
 * Is this muscle hidden by the depth view? Only on the peeled side, only
 * when a depth is chosen, and only for muscles shallower than that depth.
 * Midline structures (no _left/_right) are never hidden - there is no "other
 * side" to see them on. A muscle missing from the map counts as surface
 * (layer 1), so a structure added after the last measurement is peeled away
 * on the deep side rather than left covering everything beneath it.
 */
export function isPeeled(structureId, map, depth, side = 'right') {
  if (!depth || depth < 2 || !map) return false;
  if (!String(structureId).endsWith(`_${side}`)) return false;
  return (map.get(structureId) ?? 1) < depth;
}

/**
 * Muscle isolation (Jake, 2026-10-16): when a MUSCLE is selected, every other
 * muscle is hidden so the selected one stands clear against ghosted bone.
 * Selecting a bone keeps the old look (muscles ghosted as context), and a
 * selection that matched no mesh hides nothing.
 * @param {string} meshLayer          layer of the mesh being decided
 * @param {boolean} meshIsSelected    is this mesh part of the selection
 * @param {boolean} selectionHasMuscle does the selection light any muscle mesh
 * @returns {boolean} true if this mesh should be hidden
 */
export function hiddenByIsolation(meshLayer, meshIsSelected, selectionHasMuscle) {
  return Boolean(selectionHasMuscle) && meshLayer === 'muscle' && !meshIsSelected;
}

/**
 * Camera view offset for a panel covering part of the screen (2026-10-16,
 * review N1 / old P1 #6). The detail card covers the bottom of a phone screen
 * and the right edge on desktop, and focus() used to centre the selection
 * UNDER it. Shifting the projection by half the covered size puts the orbit
 * target in the middle of the part still visible. Returns the x/y passed to
 * camera.setViewOffset(width, height, x, y, width, height), or null for none.
 * @param {number} width   canvas width in CSS px
 * @param {number} height  canvas height in CSS px
 * @param {{right?: number, bottom?: number}} inset  covered px on each edge
 */
export function viewOffsetFor(width, height, inset = {}) {
  const clamp = (v, max) => Math.min(Math.max(Number(v) || 0, 0), max * 0.9);
  const right = clamp(inset.right, width);
  const bottom = clamp(inset.bottom, height);
  if (right < 0.5 && bottom < 0.5) return null;
  return { x: right / 2, y: bottom / 2 };
}

/**
 * How far the camera must be to fit a box of `size` into the part of the
 * screen the card leaves visible (2026-10-16, review N1). Uses the box's
 * bounding sphere, so it holds from any orbit angle. Callers take the larger
 * of this and their usual framing, so focusing never zooms in further than it
 * did before the card was accounted for.
 * @param {{x:number,y:number,z:number}} size  box size in world units
 * @param {number} fovDeg  vertical field of view in degrees
 * @param {number} width   canvas width in px
 * @param {number} height  canvas height in px
 * @param {{right?: number, bottom?: number}} inset  covered px
 */
export function fitDistance(size, fovDeg, width, height, inset = {}) {
  const r = Math.hypot(size.x || 0, size.y || 0, size.z || 0) / 2;
  if (!(r > 0) || !(width > 0) || !(height > 0)) return 0;
  const visW = Math.max(width - Math.min(Math.max(Number(inset.right) || 0, 0), width * 0.9), 1);
  const visH = Math.max(height - Math.min(Math.max(Number(inset.bottom) || 0, 0), height * 0.9), 1);
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const halfV = Math.atan(tanV * (visH / height));
  const halfH = Math.atan(tanV * (width / height) * (visW / width));
  return (r / Math.sin(Math.min(halfV, halfH))) * 1.1;
}

/** Next depth for the cycling control: off -> 2 -> 3 ... -> deepest -> off. */
export function nextPeelDepth(current, deepest) {
  if (deepest < 2) return 0;
  if (!current) return 2;
  return current >= deepest ? 0 : current + 1;
}
