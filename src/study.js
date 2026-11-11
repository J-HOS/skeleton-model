/**
 * study.js - the study section (2026-11-02, Jake). Pure logic, no DOM and no
 * three.js, so every rule here is tested in Node against the real model and
 * database.
 *
 * First version: "Find it" - the app names a structure, the user taps it on
 * the 3D model. Two subjects (muscles, bones), nine body regions chosen by
 * Jake: head, thorax, upper arm, lower arm (wrist included), hand, hip, upper
 * leg, lower leg (ankle included), foot. Hip was split out of the upper leg
 * on 2026-11-02 at Jake's request: the gluteals, iliopsoas, tensor fasciae
 * latae and the deep six rotators, and the bony pelvis (hip bone, sacrum,
 * coccyx); the thigh muscles (quadriceps, hamstrings, adductors, gracilis,
 * sartorius, pectineus) stay in the upper leg.
 *
 * Region rules (Jake's answers, 2026-11-02):
 * - Neck goes with the head; back, abdomen and the rest of the spine go with
 *   the thorax.
 * - Shoulder and hip are split by attachment: muscles that only move the
 *   scapula count as thorax, muscles that move the arm count as upper arm;
 *   at the hip, muscles acting only on the spine or pelvis count as thorax,
 *   muscles that move the thigh count as upper leg.
 * - Bones have no attachments to split by, so the shoulder girdle (scapula,
 *   clavicle) goes with the upper arm; the hip bone, sacrum and coccyx form
 *   the hip.
 *   The carpals are bones of the hand and every tarsal, the talus included,
 *   is a bone of the foot (2026-11-04, Jake, decision D1 of the 11-03 team
 *   review - how Moore and Gray's teach them; it was lower arm / lower leg).
 *
 * Left out of Find it, because they cannot be tapped fairly: teeth, the ear
 * ossicles, bones hidden inside the skull (inferior nasal concha, palatine,
 * vomer) and the foot sesamoids. Muscles with no 3D model drop out by
 * themselves: an item is built only from meshes that are in the scene.
 * Eight throat and jaw muscles are also left out for now (2026-11-04, decision
 * D3): the team review measured 0 visible pixels for each from the front, the
 * back and every Peel depth, so a round could not be fair. They stay in
 * Search and on the cards.
 */

import { classifyBone, findMuscleRecord, prettyName } from './anatomy.js?v=6a22cbdfe9ce';

export const STUDY_KINDS = Object.freeze([
  { id: 'muscles', label: 'Muscles' },
  { id: 'bones', label: 'Bones' },
  // Hidden from the picker (2026-11-11, Jake): Name it and the hidden layers
  // ship first; landmarks wait for Jake's local check. Remove `hidden` to offer it.
  { id: 'landmarks', label: 'Landmarks', hidden: true },
]);

/**
 * How a question is asked (2026-11-04, Jake). Find it: the app names a
 * structure and the user taps it. Name it: the app shows the structure and
 * the user types its name; spelling counts (see gradeName).
 */
export const STUDY_MODES = Object.freeze([
  { id: 'find', label: 'Find it' },
  { id: 'name', label: 'Name it' },
]);

export const STUDY_REGIONS = Object.freeze([
  { id: 'head', label: 'Head' },
  { id: 'thorax', label: 'Thorax' },
  { id: 'upperArm', label: 'Upper arm' },
  { id: 'lowerArm', label: 'Lower arm' },
  { id: 'hand', label: 'Hand' },
  { id: 'hip', label: 'Hip' },
  { id: 'upperLeg', label: 'Upper leg' },
  { id: 'lowerLeg', label: 'Lower leg' },
  { id: 'foot', label: 'Foot' },
]);

const REGION_IDS = new Set(STUDY_REGIONS.map((r) => r.id));

/** Database section -> region, for sections that sit wholly in one region. */
const SECTION_REGION = Object.freeze({
  'Shoulder Girdle': 'thorax',            // these muscles only move the scapula
  'Shoulder Joint': 'upperArm',           // these move the arm
  'Neck and Atlanto-Occipital Joints': 'head',
  'Back - Spinal Joints': 'thorax',
  'Abdominal and Respiratory': 'thorax',
  'Pelvic Girdle and Hip Joint': 'upperLeg',
  'Face and Scalp': 'head',
  'Muscles of Mastication': 'head',
  'Eye (Extraocular)': 'head',
  'Tongue': 'head',
  'Suprahyoid and Infrahyoid': 'head',
});

/** Muscles placed by where they lie rather than by their database section. */
const MUSCLE_OVERRIDES = Object.freeze({
  // Elbow section: the arm muscles sit in the upper arm, the rest in the forearm.
  BicepsBrachii: 'upperArm', Brachialis: 'upperArm', TricepsBrachii: 'upperArm',
  Brachioradialis: 'lowerArm', PronatorTeres: 'lowerArm', PronatorQuadratus: 'lowerArm',
  Supinator: 'lowerArm', Anconeus: 'lowerArm',
  // Hip section: psoas minor acts only on the spine and pelvis.
  PsoasMinor: 'thorax',
  // The hip region (2026-11-02): gluteals, iliopsoas, TFL and the deep six.
  Iliacus: 'hip', PsoasMajor: 'hip', GluteusMaximus: 'hip', GluteusMedius: 'hip', 'Gluteus Minimus': 'hip',
  TensorFasciaeLatae: 'hip', Piriformis: 'hip', 'Gemellus Superior': 'hip', 'Obturator Internus': 'hip',
  'Gemellus Inferior': 'hip', 'Obturator Externus': 'hip', 'Quadratus Femoris': 'hip',
  // Knee section.
  VastusLateralis: 'upperLeg', VastusIntermedius: 'upperLeg', VastusMedialis: 'upperLeg',
  Popliteus: 'lowerLeg',
});

/** Intrinsic muscles of the hand; every other wrist/hand muscle is a forearm muscle. */
const HAND_INTRINSIC = new Set([
  'AbductorPollicisBrevis', 'OpponensPollicis', 'FlexorPollicisBrevis', 'AbductorDigitiMinimi',
  'FlexorDigitiMinimi', 'OpponensDigitiMinimi', 'AdductorPollicis', 'Dorsal Interossei (Hand)',
  'Palmar Interossei (Hand)', 'Lumbricals (Hand)',
]);

/** Intrinsic muscles of the foot; every other ankle/foot muscle is a leg muscle. */
const FOOT_INTRINSIC = new Set([
  'FlexorDigitorumBrevis', 'Abductor Digiti Minimi', 'FlexorHallucisBrevis', 'AbductorHallucis',
  'FlexorDigitiMinimi (Foot)', 'QuadratusPlantae', 'Lumbricals (Foot)', 'AdductorHallucis',
  'PlantarInterossei', 'Dorsal Interossei (Foot)', 'ExtensorDigitorumBrevis',
]);

/** Region id for a muscle record, or null if it is not placed. */
export function muscleRegion(record) {
  if (!record || typeof record.name !== 'string') return null;
  if (MUSCLE_OVERRIDES[record.name]) return MUSCLE_OVERRIDES[record.name];
  if (record.section === 'Wrist and Hand Joints') return HAND_INTRINSIC.has(record.name) ? 'hand' : 'lowerArm';
  if (record.section === 'Ankle and Foot Joints') return FOOT_INTRINSIC.has(record.name) ? 'foot' : 'lowerLeg';
  return SECTION_REGION[record.section] || null;
}

/** Muscles that cannot be seen from any view the app frames (decision D3). */
export const MUSCLE_EXCLUDED = new Set([
  'Genioglossus', 'Geniohyoid', 'Hyoglossus', 'Mylohyoid', 'Stylohyoid', 'Thyrohyoid', 'Sternothyroid',
  'LateralPterygoid',
]);

/**
 * Question labels for muscles whose database name does not read well
 * (2026-11-04, team review #7). Database names are mesh lookup keys and stay
 * unchanged; these are display only. Terminologia Anatomica terms.
 */
const MUSCLE_LABELS = Object.freeze({
  'AbductorDigitiMinimi': 'Abductor Digiti Minimi (Hand)',
  'Abductor Digiti Minimi': 'Abductor Digiti Minimi (Foot)',
  'FlexorDigitiMinimi': 'Flexor Digiti Minimi Brevis (Hand)',
  'FlexorDigitiMinimi (Foot)': 'Flexor Digiti Minimi Brevis (Foot)',
  'ObliquusCapitis(SuperiorandInferior)': 'Obliquus Capitis (Superior and Inferior)',
  'RectusCapitisPosterior(MajorandMinor)': 'Rectus Capitis Posterior (Major and Minor)',
  'Scalenes(Anterior,Middle,Posterior)': 'Scalenes (Anterior, Middle, Posterior)',
  'Peroneus(Fibularis)Brevis': 'Fibularis (Peroneus) Brevis',
  'Peroneus(Fibularis)Longus': 'Fibularis (Peroneus) Longus',
  'Peroneus(Fibularis)Tertius': 'Fibularis (Peroneus) Tertius',
  'ErectorSpinae:Iliocostalis(Lumborum,Thoracis,Cervicis)': 'Erector Spinae: Iliocostalis',
  'ErectorSpinae:Longissimus(Thoracis,Cervicis,Capitis)': 'Erector Spinae: Longissimus',
  'ErectorSpinae:Spinalis(Thoracis,Cervicis)': 'Erector Spinae: Spinalis',
  'Transverse Abdominis': 'Transversus Abdominis',
  'TransverseThoracis': 'Transversus Thoracis',
  'Rhomboids(major&minor)': 'Rhomboids (Major and Minor)',
  'Trapezius(upper)': 'Trapezius (Upper)',
  'Trapezius(middle)': 'Trapezius (Middle)',
  'Trapezius(lower)': 'Trapezius (Lower)',
  'Deltoid(anteriorhead)': 'Deltoid (Anterior Head)',
  'Deltoid(middlehead)': 'Deltoid (Middle Head)',
  'Deltoid(posteriorhead)': 'Deltoid (Posterior Head)',
  'PectoralisMajor(clavicularhead)': 'Pectoralis Major (Clavicular Head)',
  'PectoralisMajor(sternalhead)': 'Pectoralis Major (Sternal Head)',
});

/** The name a muscle is asked by, and named by in Study feedback. */
export function studyMuscleLabel(name) {
  return MUSCLE_LABELS[name] || studyLabel(prettyName(name));
}

/** Bones that cannot be tapped fairly (hidden or tiny) - not asked in Find it. */
const BONE_EXCLUDED = new Set(['Inferior nasal concha', 'Palatine bone', 'Vomer', 'Sesamoid bones of foot']);

/** A bone's display name without its side, e.g. "Femur (Left)" -> "Femur". */
export function boneBaseName(display) {
  return String(display || '').replace(/ \((Left|Right)\)$/, '');
}

/** Region id for a classifyBone() result, or null if it is not asked. */
export function boneRegion(bone) {
  if (!bone) return null;
  if (bone.type === 'Tooth' || bone.type === 'Auditory ossicle') return null;
  const name = boneBaseName(bone.display);
  if (BONE_EXCLUDED.has(name)) return null;
  switch (bone.region) {
    case 'Head': case 'Neck': return 'head';
    case 'Thorax': case 'Lumbar': return 'thorax';
    case 'Pelvis': return 'hip';
    case 'Shoulder girdle': return 'upperArm';
    case 'Upper limb': return name === 'Humerus' ? 'upperArm' : 'lowerArm';
    case 'Wrist': return 'hand';
    case 'Hand': return 'hand';
    case 'Lower limb': return (name === 'Femur' || name === 'Patella') ? 'upperLeg' : 'lowerLeg';
    case 'Foot': return 'foot';
    default: return null;
  }
}

/**
 * Everything that can be asked, from the meshes actually in the scene:
 * kind -> region -> [{ key, label, ids }]. One item per structure, both sides
 * together (`ids` holds every scene id that counts as a correct tap).
 */
export function buildStudyCatalog(sceneIds, muscleIndex) {
  const catalog = { muscles: {}, bones: {} };
  for (const kind of Object.keys(catalog)) {
    for (const region of REGION_IDS) catalog[kind][region] = new Map();
  }
  for (const id of sceneIds) {
    const bone = classifyBone(id);
    if (bone) {
      const region = boneRegion(bone);
      if (!region) continue;
      const key = boneBaseName(bone.display);
      addTo(catalog.bones[region], key, key, id);
      continue;
    }
    const hit = findMuscleRecord(muscleIndex, id);
    if (!hit) continue;
    if (MUSCLE_EXCLUDED.has(hit.record.name)) continue;
    const region = muscleRegion(hit.record);
    if (!region) continue;
    addTo(catalog.muscles[region], hit.record.name, studyMuscleLabel(hit.record.name), id);
  }
  const out = { muscles: {}, bones: {} };
  for (const kind of Object.keys(catalog)) {
    for (const [region, items] of Object.entries(catalog[kind])) {
      out[kind][region] = [...items.values()].sort((a, b) => a.label.localeCompare(b.label));
    }
  }
  return out;
}

function addTo(map, key, label, id) {
  if (!map.has(key)) map.set(key, { key, label: studyLabel(label), ids: [] });
  map.get(key).ids.push(id);
}

/** Label for the question: drop the database's group tag, e.g. "(*rotator cuff muscle group)". */
export function studyLabel(label) {
  return String(label).replace(/\s*\(\*[^)]*\)/, '').trim();
}

/** Fisher-Yates shuffle, with an injectable random source for tests. */
export function shuffled(items, rand = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A fresh round over the given items. */
export function newRound(items, rand = Math.random) {
  return { items: shuffled(items, rand), index: 0, correct: 0, missed: [], answered: false };
}

export function currentItem(round) {
  return round && round.index < round.items.length ? round.items[round.index] : null;
}

/**
 * Record a tap. Either side counts. Returns { correct, item } or null if the
 * question was already answered. A tap is one attempt: right or wrong, the
 * question is then answered and the caller shows the result.
 */
export function answerTap(round, tappedId) {
  const item = currentItem(round);
  if (!item || round.answered) return null;
  const correct = item.ids.includes(tappedId);
  round.answered = true;
  if (correct) round.correct += 1; else round.missed.push(item.label);
  return { correct, item };
}

/** "Show me": reveal the answer, counted as missed. */
export function giveUp(round) {
  const item = currentItem(round);
  if (!item || round.answered) return null;
  round.answered = true;
  round.missed.push(item.label);
  return { correct: false, item };
}

/** Move to the next question. Returns false when the round is over. */
export function nextQuestion(round) {
  if (!round) return false;
  round.index += 1;
  round.answered = false;
  return round.index < round.items.length;
}

/** Which item a scene id belongs to, for "That was the ..." feedback. */
export function itemForId(items, id) {
  return items.find((item) => item.ids.includes(id)) || null;
}


/* ------------------------------------------------------- bony landmarks -- */
// Landmark study (2026-11-04, Jake). Positions come from Z-Anatomy's own
// landmark pointers, matched to the Section 11 bone cards by
// "03 Testing & Review/(C) landmarks_2026-11-04/(C) extract_landmarks.py".
// Groups are the bone cards, not body regions.

export const LANDMARK_GROUPS = Object.freeze([
  { id: 'clavicle', label: 'Clavicle' },
  { id: 'scapula', label: 'Scapula' },
  { id: 'humerus', label: 'Humerus' },
  { id: 'radius', label: 'Radius' },
  { id: 'ulna', label: 'Ulna' },
  { id: 'hand', label: 'Hand' },
  { id: 'atlasaxis', label: 'Atlas and axis' },
  { id: 'thoracic', label: 'Thoracic vertebra' },
  { id: 'lumbar', label: 'Lumbar vertebra' },
  { id: 'hip', label: 'Hip bone' },
  { id: 'sacrum', label: 'Sacrum' },
  { id: 'femur', label: 'Femur' },
  { id: 'tibia', label: 'Tibia' },
  { id: 'fibula', label: 'Fibula' },
  { id: 'foot', label: 'Foot' },
]);

/** The groups a subject is studied by: body regions, or bone cards for landmarks. */
export function studyGroups(kind) {
  return kind === 'landmarks' ? LANDMARK_GROUPS : STUDY_REGIONS;
}

const LANDMARK_GROUP_IDS = new Set(LANDMARK_GROUPS.map((g) => g.id));

/**
 * Validate landmarks.json and build group -> [item]. An item is
 * { key, label, alt, ids, points } where points maps each scene id to a
 * model-space [x, y, z]. Points for bones not in the scene are dropped. Any
 * malformed entry rejects the whole file (returns null), like parseLayerMap,
 * so a damaged file turns the feature off rather than asking wrong questions.
 */
export function parseLandmarks(raw, sceneIds) {
  if (!raw || !Array.isArray(raw.landmarks)) return null;
  const scene = new Set(sceneIds);
  const out = {};
  for (const g of LANDMARK_GROUPS) out[g.id] = [];
  const seen = new Set();
  for (const lm of raw.landmarks) {
    if (!lm || typeof lm !== 'object') return null;
    const { card, label, za, points, normals } = lm;
    if (!LANDMARK_GROUP_IDS.has(card)) return null;
    if (typeof label !== 'string' || !label || label.length > 80) return null;
    if (za != null && (typeof za !== 'string' || za.length > 120)) return null;
    if (!points || typeof points !== 'object' || Array.isArray(points)) return null;
    const key = `${card}:${label}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (normals != null && (typeof normals !== 'object' || Array.isArray(normals))) return null;
    const kept = {};
    const facing = {};
    for (const [id, p] of Object.entries(points)) {
      if (typeof id !== 'string' || id.length > 128) return null;
      if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => Number.isFinite(v) && Math.abs(v) < 5000)) return null;
      const n = normals ? normals[id] : null;
      if (n != null && (!Array.isArray(n) || n.length !== 3 || !n.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.01))) return null;
      if (scene.has(id)) { kept[id] = p; if (n) facing[id] = n; }
    }
    const ids = Object.keys(kept);
    if (!ids.length) continue;
    out[card].push({ key, label, alt: za || null, ids, points: kept, normals: facing });
  }
  for (const g of Object.keys(out)) out[g].sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Taps further than this (model units, about mm) from every landmark count for none. */
export const LANDMARK_TAP_MAX = 50;

/** Landmarks whose surface faces further from the tapped surface than this (cosine) are on another side of the bone. */
export const LANDMARK_FACING_MIN = -0.3;

/**
 * Which landmark a tap on bone `id` at model-space `point` is nearest to,
 * among `items` (the group's landmarks). Returns { item, distance } or null.
 * A landmark is stored as one point, so a tap counts for the NEAREST one:
 * that keeps neighbours (lateral condyle vs lateral epicondyle) apart
 * without a fixed radius that would be too big for one and too small for
 * another. With the tapped surface's `normal`, landmarks on the far side of
 * the bone are left out: a tap on the front of the femur is not "nearest the
 * popliteal surface" just because the bone is thin there (found 2026-11-04).
 */
export function nearestLandmark(items, id, point, max = LANDMARK_TAP_MAX, normal = null) {
  if (!Array.isArray(point) || point.length !== 3) return null;
  const n = Array.isArray(normal) && normal.length === 3 && normal.every(Number.isFinite) ? normal : null;
  let best = null;
  for (const item of items) {
    const p = item.points[id];
    if (!p) continue;
    const ln = item.normals && item.normals[id];
    if (n && ln && n[0] * ln[0] + n[1] * ln[1] + n[2] * ln[2] < LANDMARK_FACING_MIN) continue;
    const d = dist3(p, point);
    if (!best || d < best.distance) best = { item, distance: d };
  }
  return best && best.distance <= max ? best : null;
}

/** Record a landmark tap. Same contract as answerTap; also returns `nearest`. */
export function answerLandmarkTap(round, id, point, normal = null) {
  const item = currentItem(round);
  if (!item || round.answered) return null;
  const nearest = nearestLandmark(round.items, id, point, LANDMARK_TAP_MAX, normal);
  const correct = Boolean(nearest && nearest.item === item);
  round.answered = true;
  if (correct) round.correct += 1; else round.missed.push(item.label);
  return { correct, item, nearest: nearest ? nearest.item : null };
}

/* ------------------------------------------------------ Name it grading -- */
// Spelling counts (2026-11-04, Jake: "half credit if close"). Exact name =
// 1 point; one or two letters off = 1/2 point with the right spelling shown;
// anything else = 0. Capitals, spaces, hyphens, word order and small words
// ("of", "the") never cost anything; neither does leaving off a word in
// brackets when nothing else in the round shares the rest of the name.

const ORDINAL_WORDS = {
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th',
  seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th', eleventh: '11th', twelfth: '12th',
};
const PHRASES = [
  [/\bbig toe\b|\bgreat toe\b|\bhallux\b/g, '1st toe'], [/\blittle toe\b/g, '5th toe'],
  [/\bthumb\b/g, '1st finger'], [/\bindex finger\b/g, '2nd finger'], [/\bmiddle finger\b/g, '3rd finger'],
  [/\bring finger\b/g, '4th finger'], [/\blittle finger\b|\bpinky\b/g, '5th finger'],
  [/&/g, ' and '], [/\bperoneal\b/g, 'fibular'],
];
const FILLER = new Set(['of', 'the', 'and', 'a', 'muscle', 'muscles', 'bone', 'vertebra']);

function ordinal(n) {
  const v = Number(n);
  const t = v % 100;
  if (t >= 11 && t <= 13) return `${v}th`;
  return v + ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th');
}

/** Words of a name, normalised for comparison. */
export function nameTokens(text) {
  let s = String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  return s.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
    .map((w) => ORDINAL_WORDS[w] || (/^\d+$/.test(w) ? ordinal(w) : w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .filter((w) => !FILLER.has(w));
}

const sortedKey = (tokens) => [...tokens].sort().join(' ');

/** Every written form of a label that counts as that name (before ambiguity checks). */
export function nameForms(label, extra = []) {
  const forms = new Set();
  const add = (t) => { const k = nameTokens(t); if (k.length) forms.add(sortedKey(k)); };
  for (const text of [label, ...extra]) {
    if (!text) continue;
    add(text);
    add(text.replace(/\([^)]*\)/g, ' '));            // leave the bracket off
    add(text.replace(/[()]/g, ' '));                 // bracket words inline
    const sub = text.match(/^(.*?)(\S+) \((\S+)\)(\s+\S.*)$/); // "Fibularis (Peroneus) Longus"
    if (sub) add(sub[1] + sub[3] + sub[4]);
    const colon = text.indexOf(':');                 // "Erector Spinae: Iliocostalis"
    if (colon > 0) add(text.slice(colon + 1));
    if (/\([^)]*\bhead\b[^)]*\)/i.test(text)) {     // "Deltoid (Anterior Head)" -> "anterior deltoid"
      add(text.replace(/\bhead\b/gi, ' ').replace(/[()]/g, ' '));
    }
  }
  return forms;
}

/** Explicit other names a person may fairly write (common, correct synonyms). */
const NAME_ALIASES = Object.freeze({
  'Atlas (C1)': ['C1', 'Atlas'], 'Axis (C2)': ['C2', 'Axis'],
  'Hip bone (os coxae)': ['Os coxae', 'Coxal bone', 'Innominate bone', 'Pelvic bone'],
  'Manubrium of sternum': ['Manubrium'], 'Body of sternum': ['Sternal body', 'Gladiolus'],
  'Xiphoid process': ['Xiphoid'], 'Patella': ['Kneecap'], 'Clavicle': ['Collarbone', 'Collar bone'],
  'Scapula': ['Shoulder blade'], 'Talus': ['Astragalus'],
  // One mesh holds both muscles, so naming either one names what is shown.
  'Rhomboids (Major and Minor)': ['Rhomboid', 'Rhomboid major', 'Rhomboid minor'],
  'Obliquus Capitis (Superior and Inferior)': ['Obliquus capitis superior', 'Obliquus capitis inferior'],
  'Rectus Capitis Posterior (Major and Minor)': ['Rectus capitis posterior major', 'Rectus capitis posterior minor'],
  'Scalenes (Anterior, Middle, Posterior)': ['Scalene', 'Anterior scalene', 'Middle scalene', 'Posterior scalene', 'Scalenus anterior', 'Scalenus medius', 'Scalenus posterior'],
  'Intrinsic Tongue Muscles': ['Intrinsic muscles of the tongue'],
});

/** Extra accepted forms for a vertebra label, e.g. "T7 Vertebra" -> "7th thoracic". */
function vertebraAliases(label) {
  const m = String(label).match(/^([CTL])(\d+) Vertebra$/);
  if (!m) return [];
  const word = { C: 'cervical', T: 'thoracic', L: 'lumbar' }[m[1]];
  return [`${ordinal(m[2])} ${word}`];
}

/**
 * Prepare a round's items for Name it. `pool` is every item of the subject
 * (all groups) so a name that belongs to something else can be recognised.
 * Returns { accepts: Map<item, Set<form>>, others: [{ label, forms }] }.
 */
export function prepareNaming(items, pool = items) {
  const formsOf = (item) => nameForms(item.label, [...(NAME_ALIASES[item.label] || []), ...vertebraAliases(item.label), item.alt].filter(Boolean));
  // A shortened form shared by two structures names neither of them. Within
  // the round such a form is "vague" (asked to be more specific, not marked
  // wrong); across the rest of the subject it is simply dropped.
  const prune = (map) => {
    const count = new Map();
    for (const forms of map.values()) for (const f of forms) count.set(f, (count.get(f) || 0) + 1);
    const shared = new Set();
    for (const [item, forms] of map) {
      const full = sortedKey(nameTokens(item.label));
      for (const f of [...forms]) if (count.get(f) > 1 && f !== full) { forms.delete(f); shared.add(f); }
    }
    return shared;
  };
  const accepts = new Map(items.map((item) => [item, formsOf(item)]));
  const vague = prune(accepts);
  const inRound = new Set(items);
  const rest = new Map([...new Map(pool.filter((p) => !inRound.has(p)).map((p) => [p.label, p])).values()]
    .map((p) => [p, formsOf(p)]));
  prune(rest);
  const others = [...rest].map(([p, forms]) => ({ label: p.label, forms }));
  for (const item of items) others.push({ label: item.label, forms: accepts.get(item), item });
  return { accepts, others, vague };
}

/** Optimal string alignment distance (Levenshtein plus swapped neighbours). */
export function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Letters allowed off for half credit: 1 for names of 5 letters or fewer, 2 otherwise. */
export function closeLimit(label) {
  return String(label).replace(/[^A-Za-z0-9]/g, '').length <= 5 ? 1 : 2;
}

function bestDistance(answerKey, forms) {
  let best = Infinity;
  const a = answerKey.replace(/ /g, '');
  for (const f of forms) {
    best = Math.min(best, editDistance(answerKey, f), editDistance(a, f.replace(/ /g, '')));
    if (best === 0) break;
  }
  return best;
}

/**
 * Grade a typed answer for `item`. Returns
 *   { points: 1 | 0.5 | 0, verdict: 'exact' | 'close' | 'other' | 'wrong' | 'vague' | 'empty', other }
 * 'other' means the answer is (or is closest to) the name of a different
 * structure, which is never half credit: "teres minor" for teres major is
 * wrong, not a typo.
 */
export function gradeName(text, item, naming) {
  const tokens = nameTokens(text);
  if (!tokens.length) return { points: 0, verdict: 'empty', other: null };
  const key = sortedKey(tokens);
  const own = naming.accepts.get(item) || new Set();
  if (own.has(key)) return { points: 1, verdict: 'exact', other: null };
  if (naming.vague && naming.vague.has(key)) return { points: 0, verdict: 'vague', other: null };
  // Exactly another structure's name?
  for (const o of naming.others) {
    if (o.item === item) continue;
    if (o.forms.has(key)) return { points: 0, verdict: 'other', other: o.label };
  }
  const mine = bestDistance(key, own);
  let rival = null;
  let rivalDist = Infinity;
  for (const o of naming.others) {
    if (o.item === item) continue;
    const d = bestDistance(key, o.forms);
    if (d < rivalDist) { rivalDist = d; rival = o.label; }
  }
  const limit = closeLimit(item.label);
  if (mine <= limit && mine < rivalDist) return { points: 0.5, verdict: 'close', other: null };
  if (rivalDist <= mine && rivalDist <= 2) return { points: 0, verdict: 'other', other: rival };
  return { points: 0, verdict: 'wrong', other: null };
}

/** Record a typed answer. Same contract as answerTap, plus the grade. */
export function answerName(round, text, naming) {
  const item = currentItem(round);
  if (!item || round.answered) return null;
  const grade = gradeName(text, item, naming);
  // Nothing typed, or a name several structures share: not an attempt yet.
  if (grade.verdict === 'empty' || grade.verdict === 'vague') return { ...grade, item, pending: true };
  round.answered = true;
  round.correct += grade.points;
  if (grade.points < 1) round.missed.push(item.label);
  return { correct: grade.points === 1, item, ...grade };
}

/** A score for storage and display: whole points, or half points for Name it. */
export function formatPoints(n) {
  return Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`;
}
