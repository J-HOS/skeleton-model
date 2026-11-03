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
 *   The wrist (carpals) is in the lower arm, the talus in the lower leg.
 *
 * Left out of Find it, because they cannot be tapped fairly: teeth, the ear
 * ossicles, bones hidden inside the skull (inferior nasal concha, palatine,
 * vomer) and the foot sesamoids. Muscles with no 3D model drop out by
 * themselves: an item is built only from meshes that are in the scene.
 */

import { classifyBone, findMuscleRecord, prettyName } from './anatomy.js?v=7045c29c94e2';

export const STUDY_KINDS = Object.freeze([
  { id: 'muscles', label: 'Muscles' },
  { id: 'bones', label: 'Bones' },
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
    case 'Wrist': return 'lowerArm';
    case 'Hand': return 'hand';
    case 'Lower limb': return (name === 'Femur' || name === 'Patella') ? 'upperLeg' : 'lowerLeg';
    case 'Foot': return name === 'Talus' ? 'lowerLeg' : 'foot';
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
    const region = muscleRegion(hit.record);
    if (!region) continue;
    addTo(catalog.muscles[region], hit.record.name, prettyName(hit.record.name), id);
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
