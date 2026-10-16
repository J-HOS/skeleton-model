/**
 * config.js — every tunable constant in one place.
 * No logic here on purpose: if you need to change a path, a limit, or a
 * colour, this is the only file you touch.
 */

/** Where the app fetches its content and geometry from. Same-origin only. */
/**
 * One model file now holds everything: 246 bones + 127 muscles, all from a
 * single coordinate frame. The previous build loaded three files (skeleton,
 * muscles, skull detail) because they came from different datasets at
 * different scales and had to be aligned separately at runtime. They don't
 * any more, so the separate muscle and skull-detail loads are gone.
 */
export const PATHS = Object.freeze({
  dataset: 'data/anatomy.json',
  integrity: 'data/integrity.json',
  model: 'models/skeleton_v2.glb',
  // Measured muscle layers (2026-10-14), written by
  // "03 Testing & Review/(C) layer_peel/(C) measure_layers.mjs". Optional:
  // without it the depth control is simply not offered.
  layers: 'data/muscle_layers.json',
});

/**
 * Depth view (2026-10-14, Jake's request): one side of the body keeps every
 * muscle; on the other, muscles shallower than the chosen depth are removed
 * so the deeper ones can be tapped without searching. The body's RIGHT is the
 * peeled side - from the default front view that is the viewer's left.
 */
export const PEEL = Object.freeze({
  side: 'right',
  maxLayer: 20,
});

/**
 * Hard limits. These exist to stop a malformed or hostile file from
 * exhausting memory or hanging the tab — "fail closed" per the security
 * architecture doc, section 5 and 6.
 */
export const LIMITS = Object.freeze({
  searchQueryChars: 100,     // max accepted search input length
  searchResults: 40,         // max rows rendered at once
  recentItems: 8,            // max stored recently-viewed entries
  storedIdChars: 64,         // max length of any single stored structure id
  modelBytes: 96 * 1024 * 1024, // reject .glb files larger than this
  fetchTimeoutMs: 30000,     // abort a fetch that receives NO bytes for this long (a stall guard, re-armed per chunk - not a cap on the whole download)
});

/**
 * Scene colours. Mirrors (C) design-system.md tokens.
 *
 * Revised 2026-07-31 (visual polish pass — see Next Up in CLAUDE.md):
 * bone softened from #e8e2d4 (14.6:1 against --bg) to #d9d2c2 (12.6:1) so it
 * reads less stark; muscle moved from the muted #c0504d (HSL S 53%) to a more
 * saturated #c0392b (S 63%) so it doesn't wash out next to bone. Both changes
 * mirrored into (C) design-system.md §2.3 in the same session.
 *
 * Bone revised again same day, second pass, after the whiteout bug was fixed:
 * #d9d2c2 read as a grey-tan, not bone. Moved to #ece0c5 — same lightness
 * family but hue shifted toward yellow-ivory (HSL saturation 23%→51%, hue
 * ~41°) for something closer to real dry-bone colour ("milky off-white" per
 * Jake). Safe to push warmer/brighter now that ACES tone mapping (added the
 * same session) rolls highlights off instead of hard-clipping them.
 */
export const COLORS = Object.freeze({
  background: 0x0e1116,
  bone: 0xece0c5,
  muscle: 0xc0392b,
  selected: 0x22d3ee,

  /**
   * Tendon / attachment. Pale and desaturated, as real tendon and aponeurosis
   * are against red muscle belly.
   *
   * It must be lighter than every muscle colour in EVERY channel, which is a
   * hard constraint rather than a taste one: attachment tinting works by making
   * this the material colour and using vertex colours to darken back down to
   * the belly, and a vertex colour can only ever darken. (226, 214, 194) clears
   * the lightest section colour, 0xd68048, on all three. Asserted in the tests.
   */
  attachment: 0xe2d6c2,
});

/**
 * Per-section muscle colour family, added 2026-07-31 so neighbouring muscles
 * in different regions don't blend into one red mass — previously every
 * muscle mesh shared one flat colour from the exporter. All ten stay inside
 * the same crimson-to-terracotta hue range as COLORS.muscle (same family,
 * different member) rather than spanning the rainbow, so at a glance the
 * whole layer still reads as "muscle" — only up close do neighbours separate.
 * Keyed by muscle_database.json's `section` field. Any section not listed
 * here (should not happen — all ten are covered) falls back to COLORS.muscle.
 */
export const MUSCLE_SECTION_COLORS = Object.freeze({
  'Neck and Atlanto-Occipital Joints': 0xd2373d,
  'Shoulder Girdle': 0xc0392b,
  'Shoulder Joint': 0xd0592f,
  'Elbow Joint Complex': 0xaf2b27,
  'Wrist and Hand Joints': 0xd68048,
  'Back - Spinal Joints': 0x9a232b,
  'Abdominal and Respiratory': 0xb84029,
  'Pelvic Girdle and Hip Joint': 0xc83b2d,
  'Knee Joint': 0xb35128,
  'Ankle and Foot Joints': 0xcd672e,
  // Head and anterior neck, added 2026-10-14. Same red family; each must stay
  // darker than COLORS.attachment in every channel (a test checks this).
  'Face and Scalp': 0xc4453a,
  'Muscles of Mastication': 0xa8322c,
  'Eye (Extraocular)': 0xb5473f,
  'Tongue': 0xc25a4a,
  'Suprahyoid and Infrahyoid': 0xb93a34,
});

/**
 * Bone surface types, added 2026-08-01. Keyed by the leading token of the
 * .glb's own material name (see boneSurfaceKey() in anatomy.js); anything not
 * listed falls back to COLORS.bone.
 *
 * This is what closes the "skull sutures and bony landmarks don't read clearly"
 * problem from 2026-07-31. That session treated it as a lighting problem and
 * ended with real screen-space ambient occlusion as the documented next step —
 * ~7 more vendored three.js files, a meaningful dependency increase for a
 * security-conscious build. It was never a lighting problem: Z-Anatomy already
 * models sutures as their own material slot (`Suture-1..8`, 2.6% of the model's
 * triangles), and the app was flattening every slot to one bone colour and
 * erasing the distinction before any light hit it. Colouring from the data is
 * both more accurate and free.
 *
 * Values stay inside the bone family rather than being decorative:
 *   suture    - the dark line of a real cranial suture, low-saturation brown
 *   cartilage - articular cartilage caps, slightly cool and lighter than bone
 *   teeth     - enamel, whiter and less yellow than bone
 *   dentine   - the softer layer under enamel, marginally darker
 *
 * Suture revised 2026-08-02, by eye in the running app rather than reasoned
 * about: 0x9c8a68 -> 0xa7946f, about 7% lighter. The first pass was too dark —
 * at normal viewing distance a near-black seam reads as a crack or a render
 * artefact rather than as a joint between two plates. Lifting it keeps the
 * plates legibly separate while letting the line sit in the bone family.
 * This is the first of the four that has actually been looked at; cartilage,
 * teeth and dentine are still first-pass guesses.
 */
export const BONE_SURFACE_COLORS = Object.freeze({
  suture: 0xa7946f,
  cartilage: 0xe8eced,
  teeth: 0xf5efe2,
  dentine: 0xe0d3b6,
});

/**
 * Opacity used for two non-destructive "see structures that are hidden
 * behind something else" behaviours, added 2026-07-31:
 *   dimOpacity   - everything except the selected structure fades to this,
 *                  so picking a deep muscle reveals it even under bone.
 *   xrayOpacity  - the skeleton layer fades to this when x-ray mode is on,
 *                  so the muscle layer is visible through bone at all times,
 *                  not only on selection. This is the `xray` flag the old
 *                  wireframe carried but never wired up.
 */
export const RENDER = Object.freeze({
  dimOpacity: 0.18,
  xrayOpacity: 0.16,

  /**
   * How far each muscle's colour may drift from its section colour, per
   * varyLightness() in anatomy.js.
   *
   * Added 2026-08-01 at 0.13, on the reasoning that the ten section colours
   * separate one region from another but every muscle inside a region shared
   * one exact colour, so the three vastus heads or the hamstring group read as
   * a single mass.
   *
   * SET TO 0 ON 2026-08-02 after actually looking at it in the app, which is
   * the first time anyone had. The reasoning above is sound and the effect
   * works — it is just not what you want here: a lightness offset applied per
   * muscle reads as uneven lighting or dirt on the model rather than as an
   * anatomical boundary, because real adjacent muscle bellies are the same
   * colour and are told apart by the groove between them, not by tone. Chasing
   * that seam with a tone step fights the shading that already describes it.
   *
   * Deliberately kept as a live setting at 0 rather than ripped out:
   * varyLightness() with amount 0 is exactly the identity, the machinery is
   * still tested below, and the dev panel's slider brings it back instantly if
   * a future lighting change makes the grooves less legible. Contact definition
   * is better pursued through the roughness split and, eventually, real ambient
   * occlusion.
   */
  muscleShadeVariance: 0,

  /**
   * Surface finish. Muscle is deliberately glossier than bone: a little
   * specular response is what makes a belly look rounded and a groove look
   * deep, and it is the cheapest available substitute for the ambient
   * occlusion this build does not have. Bone stays matte — dry bone is matte,
   * and the suture/cartilage colours now carry its detail instead.
   */
  boneRoughness: 0.78,
  boneMetalness: 0.02,
  muscleRoughness: 0.52,
  muscleMetalness: 0.06,

  /**
   * The single roughness/metalness every surface shared before the split
   * above (the 2026-07-31 values). Nothing in the shipping render path reads
   * these — they exist so the dev panel's "roughness split: off" position is
   * the real previous appearance rather than an invented one. An A/B control
   * is only worth trusting if its "off" state is what actually shipped before.
   */
  flatRoughness: 0.74,
  flatMetalness: 0.02,

  /**
   * Attachment-point tinting: how far each muscle's ends are pulled toward
   * COLORS.attachment, and what fraction of its length at each end counts as
   * an end.
   *
   * SHIPPED ON at 0.5 on 2026-09-03, after judging the 2026-08-31 renders.
   * 0.5 is the only strength those renders were made at, so it is the only
   * strength that has actually been looked at — change it and you are back to
   * an unjudged constant, which on this project has run two wrong out of three.
   * The evidence is "03 Testing & Review/(C) tint_gate_2026-08-31.png" (the
   * gate doing its job) and "(C) tint_gate_pectoralis_2026-08-31.png" (the
   * muscle it protects). Ships as three numbers, not one: strength here, dose
   * in attachmentSpan, and eligibility in attachmentTaperMax. All three were
   * set by looking; none of them survives being tuned on reasoning alone.
   *
   * The geometry is a heuristic (see axialParameter in anatomy.js): a muscle's
   * long axis stands in for "which way is it from origin to insertion", because
   * the database records attachments as text and nothing in the mesh data marks
   * which vertices are which end. The honest version needs real per-muscle
   * attachment annotation, which is a large piece of work — hence testing the
   * cheap version first, on 2026-08-02, rather than committing to it blind.
   *
   * Worth knowing before judging it: a per-muscle LIGHTNESS offset was tried
   * the same day and rejected, because tone variation across a muscle reads as
   * uneven lighting rather than as anatomy (see muscleShadeVariance above).
   * An attachment gradient is a different proposition — it follows a real
   * anatomical boundary and changes hue and saturation, not just lightness —
   * but it is the same family of idea and deserves the same suspicion. That
   * suspicion is what the taper gate below turned out to be for: ungated, the
   * effect failed in exactly the predicted way on pectoralis and trapezius.
   *
   * Known and accepted at ship: the heuristic still cannot tell origin from
   * insertion, so both ends of a muscle get the same treatment, and 57 of the
   * 126 muscles are gated out and carry no attachment cue at all. Absence of a
   * pale end therefore means "not eligible", NOT "no tendon here" — worth
   * remembering before this is ever described to a user as anatomical data.
   */
  attachmentTint: 0.5,

  /**
   * Corrected 2026-08-31 from 0.28, which had never been looked at. At 0.28 the
   * tint pulls 18.4% of all muscle surface toward tendon and the whole body
   * reads as faded at navigating distance — the same failure muscleShadeVariance
   * had, reached a different way. At 0.12 it is 5.8%, the model keeps its
   * saturation, and the pale collects at the knee, ankle and elbow where the
   * tendons actually are. See (C) measure_attachment_tint.mjs for the figures
   * and (C) tint_body_2026-08-31.png for the three-up.
   */
  attachmentSpan: 0.12,

  /**
   * Muscles whose taper ratio exceeds this are not tinted at all — see
   * axialTaper() in anatomy.js for what the ratio is and why it decides this.
   *
   * 0.8 is where "narrows into its ends" stops being true. Measured at the
   * span above, it keeps biceps (0.46), gastrocnemius (0.62), vastus lateralis
   * (0.63) and gluteus maximus (0.44), and drops pectoralis major (0.88),
   * middle trapezius (1.16) and the long digital muscles (up to 2.93) — the
   * ones the renders showed reading as bleach rather than tendon. It excludes
   * 57 of the 127 muscles in the model.
   *
   * Raising it past 1.0 starts tinting muscles that are WIDER at the end being
   * paled, which cannot read as a tendon under any lighting. Note the ratio is
   * measured over the tinted span, so changing attachmentSpan changes which
   * muscles qualify — at the old 0.28 the same limit excluded 47.
   */
  attachmentTaperMax: 0.8,
});

/**
 * Anatomical layers. `ready` is set at runtime once meshes for that layer
 * actually exist in the scene — it is never hardcoded true, so the UI can
 * not offer a layer that has no geometry behind it.
 */
export const LAYERS = Object.freeze([
  { id: 'skeleton', label: 'Skeleton', color: '#ece0c5' },
  { id: 'muscle', label: 'Muscle', color: '#c0392b' },
  { id: 'ligaments', label: 'Ligaments', color: '#d9b25a' },
  { id: 'nerves', label: 'Nerves', color: '#e8d44d' },
  { id: 'vessels', label: 'Vessels', color: '#4d7fe8' },
]);

/** Model is scaled so its longest axis is this many world units. */
export const MODEL_FIT_UNITS = 7;

/**
 * Short attribution shown on every content card. The full, licence-compliant
 * notice is CREDITS below, shown on the Credits screen.
 *
 * Rewritten 2026-10-08. The previous line credited the 2013 flashcard deck as
 * the content source; since 2026-09-16 every entry is original wording,
 * verified against NIH/NCBI StatPearls and Kenhub, so that was no longer true.
 */
export const ATTRIBUTION =
  'Muscle text: original, verified against NIH/NCBI StatPearls, Kenhub and ' +
  'university anatomy tables. ' +
  '3D model: BodyParts3D © DBCLS (CC BY-SA 2.1 JP), mixed and modified by ' +
  'Z-anatomy.com (CC BY-SA 4.0); ear ossicles original to this project. ' +
  'See Credits.';

/**
 * Full credits and licences — the notice CC BY-SA requires. Decided
 * 2026-10-08: the app is published FREE and complies with share-alike.
 *
 * Keep in step with `05 System/(C) LICENSES.md` and with the licence stamp
 * written into the .glb by `01 3D Model/(C) stamp_glb_licence.py`; the test
 * suite checks the .glb stamp against OSSICLE_NODES.
 *
 * The six ossicle nodes keep their names (the app's bone lookup uses them),
 * but since 2026-10-09 they carry the project's ORIGINAL malleus, incus and
 * stapes, swapped in by `01 3D Model/(C) swap_ossicles_glb.py`. The University
 * of Dundee meshes (CC BY-NC-SA) are gone, so the whole model is CC BY-SA with
 * no non-commercial exception. The test suite checks that none comes back.
 */
export const OSSICLE_NODES = Object.freeze([
  'Malleus_r_ZA', 'Incus_r_ZA', 'Stapes_r_ZA',
  'Malleus_l_ZA', 'Incus_l_ZA', 'Stapes_l_ZA',
]);

export const CREDITS = Object.freeze([
  {
    title: 'BodyParts3D',
    text: 'BodyParts3D, Copyright© The Database Center for Life Science ' +
      'licensed by CC Attribution-Share Alike 2.1 Japan',
    note: 'Source of the muscle meshes and, through Z-Anatomy, most bone meshes.',
    links: [
      ['Licence', 'https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en'],
      ['BodyParts3D', 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html'],
    ],
  },
  {
    title: 'Z-Anatomy',
    text: '"BodyParts3D, © The Database Center for Life Science licensed under ' +
      'CC Attribution-Share Alike 2.1 Japan" mixed and modified by ' +
      "'Z-anatomy.com'. Z-Anatomy is licensed CC BY-SA 4.0 " +
      '(Gauthier Kervyn and contributors).',
    note: 'Source of the bone meshes and several muscle meshes.',
    links: [
      ['Licence', 'https://creativecommons.org/licenses/by-sa/4.0/'],
      ['Z-Anatomy', 'https://github.com/Z-Anatomy/Models-of-human-anatomy'],
    ],
  },
  {
    title: 'Auditory ossicles (malleus, incus, stapes)',
    text: 'Original to the Skeleton Model project: built from published ' +
      'measurements and textbook descriptions, not from any third-party ' +
      'model. Part of the combined model under CC BY-SA 4.0.',
  },
  {
    title: 'Changes made for this app',
    text: 'All meshes were rescaled and repositioned into one coordinate frame, ' +
      'decimated, renamed, re-materialled, and converted to glTF; muscles were ' +
      'mirrored to make left and right sides. The combined 3D model is ' +
      'licensed CC BY-SA 4.0. You may reuse the model under those same terms.',
  },
  {
    title: 'three.js',
    text: 'three.js 0.160.1, Copyright 2010-2023 Three.js Authors. MIT License.',
    links: [['Licence', 'https://github.com/mrdoob/three.js/blob/r160/LICENSE']],
  },
  {
    title: 'Muscle content',
    text: 'Origins, insertions, actions and innervations are written in original ' +
      'wording and verified against NIH/NCBI StatPearls articles and Kenhub, ' +
      'and checked against university medical-school anatomy tables and ' +
      'atlases (UAMS/TTUHSC, University of Washington, Loyola) and ' +
      'Radiopaedia; each entry cites its sources. These sources were used for ' +
      'facts only; no text is reproduced from them.',
  },
]);

/** Shown once per session. This is a reference tool, not a clinical one. */
export const DISCLAIMER =
  'Educational anatomical reference. Not a diagnostic or clinical ' +
  'decision-making tool. Verify against a primary source before clinical use.';
