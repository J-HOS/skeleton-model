/**
 * main.js — boot and wiring. The only module that knows about all the others.
 *
 * Boot order matters and is deliberate:
 *   1. content loads and is integrity-checked FIRST
 *   2. only then is the 3D scene created
 * A user should never see a skeleton they can tap before we know the data
 * behind it is intact — that is "fail closed" applied to the UI, not just to
 * the loader.
 */

import { LAYERS, PATHS } from './config.js?v=6a22cbdfe9ce';
import { loadDataset, buildSearchIndex } from './dataset.js?v=6a22cbdfe9ce';
import { classifyBone, deepestLayer, findMuscleRecord, nextPeelDepth, parseLayerMap, prettyName } from './anatomy.js?v=6a22cbdfe9ce';
import { STUDY_KINDS, STUDY_MODES, answerLandmarkTap, answerName, answerTap, studyMuscleLabel, boneBaseName, buildStudyCatalog, currentItem, formatPoints, giveUp, itemForId, newRound, nextQuestion, parseLandmarks, prepareNaming, studyGroups } from './study.js?v=6a22cbdfe9ce';
import { fetchLocal, sanitizeQuery } from './security.js?v=6a22cbdfe9ce';
import { getRecents, pushRecent, hasAcknowledgedDisclaimer, acknowledgeDisclaimer, clearAll, getBilateral, setBilateral, getStudyBest, recordStudyScore, studyKey } from './storage.js?v=6a22cbdfe9ce';
import { Viewer } from './viewer.js?v=6a22cbdfe9ce';
import { mountDevPanel } from './devpanel.js?v=6a22cbdfe9ce';
import { byId } from './dom.js?v=6a22cbdfe9ce';
import * as ui from './ui.js?v=6a22cbdfe9ce';

const state = {
  data: null,
  viewer: null,
  searchIndex: [],
  // Skeleton and Muscle on at start (Jake, 2026-10-15 team review decision D2).
  layerVisibility: Object.fromEntries(LAYERS.map((l) => [l.id, l.id === 'skeleton' || l.id === 'muscle'])),
  xray: false,
  bilateral: getBilateral(),
  peelDepth: 0,
  // Study (2026-11-02): the catalog is built once the model is in; `study` is
  // the round in progress, or null.
  catalog: null,
  landmarkCatalog: null,
  study: null,
  studyKind: 'muscles',
  studyMode: 'find',
};

/* ------------------------------------------------------------- selection -- */

function show(structureId) {
  if (!structureId) return;
  pushRecent(structureId);
  // More than one id lit means a left/right pair (bilateral mode, or a search
  // pick, which has no side) — the card says so rather than naming one side.
  const lit = state.viewer?.select(structureId);
  const both = Boolean(lit && lit.size > 1);

  const bone = classifyBone(structureId);
  if (bone) {
    const shown = both ? { ...bone, display: bone.display.replace(/ \((Left|Right)\)$/, ' (Both sides)') } : bone;
    ui.renderBone(shown, bone.landmark ? state.data.landmarks[bone.landmark] : null);
    return;
  }

  const muscle = findMuscleRecord(state.data.muscleIndex, structureId);
  if (muscle) {
    ui.renderMuscle(muscle.record, both ? 'both' : muscle.side);
    return;
  }

  // Unknown mesh: say so honestly rather than showing an empty card. For a
  // reference tool used clinically, "no data" must never look like "no
  // findings".
  ui.renderBone(
    { display: structureId, region: 'Unclassified', type: 'No content record', landmark: null },
    null
  );
}

/**
 * Selecting from search also frames the structure, since it may be off-screen.
 * 2026-10-15 (team review P0): first make it visible - turn on any layer that
 * hides it, and step Deep view back only as far as this muscle's layer - so
 * a search pick never lands on an empty model. "No mesh" is said only when
 * the structure has no mesh at all, never because one is merely hidden.
 */
function revealForFocus(structureId) {
  const viewer = state.viewer;
  if (!viewer) return false;
  const info = viewer.revealInfo(structureId);
  if (!info.exists) return false;
  let changed = false;
  for (const layer of info.layers) {
    if (state.layerVisibility[layer] === false) {
      state.layerVisibility[layer] = true;
      viewer.setLayerVisible(layer, true);
      changed = true;
    }
  }
  if (info.peeledLayer !== null) {
    state.peelDepth = info.peeledLayer >= 2 ? info.peeledLayer : 0;
    viewer.setPeelDepth(state.peelDepth);
    changed = true;
  }
  if (changed) refreshLayers();
  return true;
}

function showAndFocus(structureId) {
  ui.closeSearch();
  const hasMesh = revealForFocus(structureId);
  show(structureId);
  if (!hasMesh) {
    ui.flashHint('No 3D model for this structure yet - its card is shown.', 4000);
    return;
  }
  // The card has just opened; give the viewer its size now (the observer
  // fires a microtask later) so focus() frames for the visible area.
  updateViewInset();
  state.viewer.focus(structureId);
}

/* ----------------------------------------------------------------- model -- */

/**
 * Add every bone currently in the scene to the search index, de-duplicated.
 *
 * Teeth are excluded from search on purpose. They are in the model — a skull
 * with empty sockets looks wrong — and tapping one still identifies it. But 28
 * individually-named teeth in a result list is noise for someone looking up a
 * muscle attachment, which is what this tool is for.
 */
function indexBones() {
  const known = new Set(state.searchIndex.map((i) => i.id));
  for (const id of state.viewer.structureIds()) {
    if (known.has(id)) continue;
    const bone = classifyBone(id);
    if (!bone || bone.type === 'Tooth') continue;
    state.searchIndex.push({
      id,
      name: bone.display,
      subtitle: `${bone.region} · ${bone.type}`,
      kind: 'bone',
      haystack: `${bone.display} ${bone.region} ${bone.type}`.toLowerCase(),
    });
  }
}

function refreshLayers() {
  ui.renderLayers(
    {
      visible: state.layerVisibility,
      available: new Set(LAYERS.map((l) => l.id).filter((id) => state.viewer?.hasLayer(id))),
    },
    (layerId) => {
      // A round sets the layers it needs; changing them mid-round could hide
      // every answer (team review 2026-11-03). End restores the user's own.
      if (state.study) { ui.flashHint('The round sets the layers. End it to change them.'); return; }
      state.layerVisibility[layerId] = !state.layerVisibility[layerId];
      state.viewer.setLayerVisible(layerId, state.layerVisibility[layerId]);
      refreshLayers();
    },
    state.viewer?.layerMap && state.viewer.hasLayer('muscle')
      ? { depth: state.peelDepth, deepest: deepestLayer(state.viewer.layerMap), onCycle: cyclePeel }
      : null
  );
}

/**
 * Depth view (2026-10-14): each press removes one more layer of muscle from
 * the body's right side; the left side stays whole. Turning it on also turns
 * the muscle layer on, since there is nothing to peel otherwise.
 */
function cyclePeel(fromRound = false) {
  if (state.study && !fromRound) { ui.flashHint('Use Peel a layer in the round bar.'); return; }
  const deepest = deepestLayer(state.viewer.layerMap);
  state.peelDepth = nextPeelDepth(state.peelDepth, deepest);
  if (state.peelDepth && !state.layerVisibility.muscle) {
    state.layerVisibility.muscle = true;
    state.viewer.setLayerVisible('muscle', true);
  }
  state.viewer.setPeelDepth(state.peelDepth);
  refreshLayers();
  ui.flashHint(state.peelDepth
    ? `Body's right side: muscles above layer ${state.peelDepth} removed (deepest is ${deepest}). Left side unchanged.`
    : 'Deep view off.');
}

/** Load the measured muscle layers. Optional: a failure just hides the control. */
async function loadLayerMap() {
  try {
    const map = parseLayerMap(await fetchLocal(PATHS.layers));
    if (!map) throw new Error('muscle_layers.json failed validation');
    state.viewer.setLayerMap(map);
  } catch (error) {
    console.info('Deep view unavailable:', error.message);
  }
}

/* ------------------------------------------------------------------ boot -- */

/**
 * Make sure styles.css actually applied (2026-10-15). Jake left the app open
 * on his iPhone overnight; on refresh Safari ran the scripts but the
 * stylesheet never arrived, so the page rendered unstyled: the canvas in
 * normal flow, the search bar below it with a Close button that did nothing,
 * the menu scrolled off the top. Only the model could be moved.
 *
 * Sentinel: styles.css makes #canvas-host position:fixed; the browser default
 * is static. If it is missing, fetch the stylesheet again with a cache-busting
 * query; if that fails too, reload once (guarded so it cannot loop).
 */
const STYLE_RELOAD_KEY = 'skeletonModel.styleReload';

function stylesApplied() {
  return getComputedStyle(byId('canvas-host')).position === 'fixed';
}

async function ensureStyles() {
  if (stylesApplied()) {
    try { sessionStorage.removeItem(STYLE_RELOAD_KEY); } catch { /* storage may be blocked */ }
    return true;
  }
  console.warn('styles.css did not apply - fetching it again');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  // Re-request the SAME stylesheet the page links to (it carries the build's
  // ?v= suffix on the live site - 2026-10-16), plus a cache-buster.
  const current = document.querySelector('link[rel="stylesheet"]')?.getAttribute('href') || 'styles.css';
  link.href = `${current}${current.includes('?') ? '&' : '?'}retry=${Date.now()}`;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 8000);
    link.addEventListener('load', () => { clearTimeout(timer); resolve(); });
    link.addEventListener('error', () => { clearTimeout(timer); resolve(); });
    document.head.append(link);
  });
  if (stylesApplied()) return true;

  let tried = false;
  try { tried = sessionStorage.getItem(STYLE_RELOAD_KEY) === '1'; } catch { /* treat as not tried */ }
  if (!tried) {
    try { sessionStorage.setItem(STYLE_RELOAD_KEY, '1'); } catch { /* reload anyway */ }
    location.reload();
    return false;
  }
  ui.showError('The page did not finish loading. Check your connection and reload.');
  return false;
}

/**
 * The page must never be scrolled (2026-10-15 - see the html/body rule in
 * styles.css for the overnight iPhone bug). CSS removes the scroll room; this
 * is the backstop: stop the browser restoring an old position on reload, and
 * put the page back at the top whenever anything (iOS focus scrolling, a tab
 * waking up, a rotation) moves it.
 */
function keepPageAtTop() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const reset = () => {
    const root = document.scrollingElement || document.documentElement;
    if (root.scrollTop || root.scrollLeft || window.scrollY || window.scrollX) window.scrollTo(0, 0);
    if (document.body.scrollTop) document.body.scrollTop = 0;
  };
  reset();
  window.addEventListener('scroll', reset, { passive: true });
  window.addEventListener('pageshow', reset);
  window.addEventListener('resize', reset);
  window.addEventListener('focusout', () => setTimeout(reset, 50));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reset();
  });
}

async function boot() {
  keepPageAtTop();
  if (!(await ensureStyles())) return;
  ui.setLoading('Verifying anatomical data…');
  try {
    state.data = await loadDataset();
    state.searchIndex = buildSearchIndex(state.data.muscles);
  } catch (error) {
    ui.showError(
      'The anatomical database could not be verified, so the app has stopped rather than ' +
        'show content that may be incorrect.',
      { detail: error }
    );
    return;
  }

  ui.setLoading('Loading the 3D model… (Wi-Fi recommended)');
  state.viewer = new Viewer(byId('canvas-host'), state.data.muscleIndex);
  state.viewer.onSelect(show);
  watchCardForViewInset();
  state.viewer.bilateral = state.bilateral;

  try {
    // Progress in MB, not percent: GitHub Pages compresses the model (~13 MB
    // on the wire) but the reader counts the unpacked bytes (~19 MB), so the
    // size header (when present) does not match what is counted here.
    let shownMb = -1;
    const added = await state.viewer.load(PATHS.model, {
      replace: true,
      onProgress: (bytes) => {
        const mb = Math.floor(bytes / (1024 * 1024) * 2) / 2;
        if (mb === shownMb) return;
        shownMb = mb;
        ui.setLoading(`Loading the 3D model… ${mb.toFixed(1)} MB (Wi-Fi recommended)`);
      },
    });
    for (const [id, visible] of Object.entries(state.layerVisibility)) {
      state.viewer.setLayerVisible(id, visible);
    }
    indexBones();
    await loadLayerMap();
    await loadLandmarks();
    ui.flashHint(`${added.length} structures loaded · ${state.data.muscles.length} muscle records`);
  } catch (error) {
    // A 404 here almost always means the server is an older process that
    // predates a change to which model files it serves — serve.py does not
    // hot-reload. Say so, rather than making the reader open the console.
    const message = error.status === 404
      ? `The server could not find ${error.path}. If you changed the model, ` +
        'stop serve.py and start it again — it does not reload by itself.'
      : 'The 3D model could not be loaded. The reference content still works — try searching.';
    ui.showError(message, { detail: error, onRetry: () => location.reload() });
  }

  refreshLayers();
  ui.setLoading(null);
  wireInterface();

  // Development instrument, loopback hosts only — mountDevPanel() decides and
  // returns null everywhere else. Mounted after the model so it has meshes to
  // repaint; harmless if the load above failed, since retune() then iterates
  // an empty list.
  mountDevPanel(state.viewer);

  // First-run hint waits until the notice is dismissed (2026-10-16, review N3):
  // started before, its timer ran out unseen behind the notice.
  if (!hasAcknowledgedDisclaimer()) {
    ui.renderDisclaimer(() => { acknowledgeDisclaimer(); firstRunHint(); });
  }
}

/**
 * Closing the detail panel also clears the 3D selection, which un-dims the
 * rest of the model (see Viewer.select in viewer.js). Without this, once a
 * user picked a structure the model would stay dimmed with no way back to
 * a normal view short of picking something else.
 */
/**
 * Tell the viewer how much of the screen the detail card covers, so the
 * selection is framed in the uncovered part (2026-10-16, review N1). Phone
 * layout (styles.css, max-width 640px): a bottom sheet; otherwise a right-hand
 * panel. offsetWidth/offsetHeight ignore the slide transform, so this is the
 * card's resting size, known the moment it opens. Watched with a
 * MutationObserver on the card's class, so every open/close path is covered.
 */
const PHONE_LAYOUT = '(max-width: 640px)';
function updateViewInset() {
  if (!state.viewer) return;
  // During a study round the bar at the bottom covers the screen instead.
  if (state.study && !byId('studyBar').hidden) {
    state.viewer.setViewInset({ bottom: byId('studyBar').offsetHeight + 16 });
    return;
  }
  const card = byId('info');
  if (!card.classList.contains('open')) { state.viewer.setViewInset({}); return; }
  const phone = window.matchMedia(PHONE_LAYOUT).matches;
  state.viewer.setViewInset(phone ? { bottom: card.offsetHeight } : { right: card.offsetWidth });
}
function watchCardForViewInset() {
  new MutationObserver(updateViewInset).observe(byId('info'), { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', updateViewInset);
  updateViewInset();
}

function closeInfoPanel() {
  ui.closeInfo();
  state.viewer?.select(null);
}

/* ----------------------------------------------------------------- study */
// "Find it" (2026-11-02, Jake): pick muscles or bones and a region; the app
// names a structure and the user taps it on the model. While a round runs,
// taps go to studyTap() instead of opening the detail card. Everything the
// round changes (layers, Deep view, X-ray, view) is put back by endStudy().

function studyCatalog() {
  if (!state.catalog && state.viewer) {
    state.catalog = buildStudyCatalog(state.viewer.structureIds(), state.data.muscleIndex);
  }
  if (state.catalog) state.catalog.landmarks = state.landmarkCatalog || {};
  return state.catalog;
}

/** Load the placed landmarks (2026-11-04). Optional: without them the Landmarks tab is empty. */
async function loadLandmarks() {
  try {
    const parsed = parseLandmarks(await fetchLocal(PATHS.landmarks), state.viewer.structureIds());
    if (!parsed) throw new Error('landmarks.json failed validation');
    state.landmarkCatalog = parsed;
  } catch (error) {
    console.info('Landmark study unavailable:', error.message);
  }
}

const groupLabel = (kind, id) => studyGroups(kind).find((r) => r.id === id)?.label || id;
const kindLabel = (id) => STUDY_KINDS.find((k) => k.id === id)?.label || id;
const modeLabel = (id) => STUDY_MODES.find((m) => m.id === id)?.label || id;
// One side of a pair, for framing: the right side if there is one.
const oneSide = (ids) => { const r = ids.filter((id) => /_r_ZA$|_right$/.test(id)); return r.length ? r : ids; };
const rightPoint = (item) => item.points[oneSide(item.ids)[0]] || Object.values(item.points)[0];

function bestText(kind, group, mode) {
  const b = getStudyBest()[studyKey(kind, group, mode)];
  if (!b) return null;
  return mode === 'name' ? `${formatPoints(b.best / 2)}/${b.total / 2}` : `${b.best}/${b.total}`;
}

function openStudy() {
  if (!okToLeaveStudy()) return;
  endStudy();
  ui.closeSearch();
  closeInfoPanel();
  const catalog = studyCatalog();
  if (!catalog) { ui.flashHint('Study needs the 3D model - it has not loaded.'); return; }
  ui.renderStudyPicker({
    kinds: STUDY_KINDS.filter((k) => !k.hidden),
    modes: STUDY_MODES,
    groups: studyGroups,
    counts: (kind, group) => (catalog[kind]?.[group] || []).length,
    best: bestText,
    kind: state.studyKind,
    mode: state.studyMode,
    onStart: startStudy,
  });
}

function setXrayState(on) {
  state.xray = on;
  state.viewer?.setXray(on);
  const btn = byId('xrayBtn');
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
}

function startStudy(kind, region, mode = 'find') {
  const catalog = studyCatalog();
  const items = catalog?.[kind]?.[region] || [];
  if (!items.length) return;
  const viewer = state.viewer;
  if (!state.study) {
    state.study = { saved: { layers: { ...state.layerVisibility }, peel: state.peelDepth, xray: state.xray } };
  }
  const naming = mode === 'name' ? prepareNaming(items, Object.values(catalog[kind]).flat()) : null;
  Object.assign(state.study, { kind, region, mode, items, naming, round: newRound(items), leaveArmedUntil: 0 });
  state.studyKind = kind;
  state.studyMode = mode;
  closeInfoPanel();
  // Bones and landmarks: skeleton only. Muscles: skeleton for orientation plus
  // the region's muscles; everything else off.
  for (const layer of LAYERS) {
    const on = layer.id === 'skeleton' || (kind === 'muscles' && layer.id === 'muscle');
    state.layerVisibility[layer.id] = on;
    viewer.setLayerVisible(layer.id, on);
  }
  state.peelDepth = 0;
  viewer.setPeelDepth(0);
  // Muscle rounds ghost the skeleton (X-ray) and let only muscles answer a
  // tap, so a muscle behind bone can be seen and hit (team review 2026-11-03).
  // Bone and landmark rounds show solid bone.
  setXrayState(kind === 'muscles');
  viewer.setTapLayer(kind === 'muscles' ? 'muscle' : null);
  const allIds = [...new Set(items.flatMap((item) => item.ids))];
  state.study.allIds = allIds;
  // Landmark rounds show only the card's bones, so the bone stands out and a
  // tap cannot land on a neighbour.
  if (kind === 'muscles') viewer.setStudyScope(allIds);
  else if (kind === 'landmarks') viewer.setStudyScope(allIds, 'skeleton');
  else viewer.setStudyScope(null);
  viewer.selectIds([]);
  viewer.setMarkers([]);
  refreshLayers();
  viewer.onSelect(studyTap);
  document.body.classList.add('studying');
  drawStudy();
  updateViewInset();
  if (mode === 'find') viewer.frameIds(kind === 'landmarks' ? oneSide(allIds) : allIds);
  else showNameQuestion();
}

/** Name it: show the structure being asked. */
function showNameQuestion() {
  const study = state.study;
  const item = currentItem(study.round);
  if (!item) return;
  const viewer = state.viewer;
  if (study.kind === 'landmarks') {
    viewer.selectIds([]);
    viewer.setMarkers(Object.values(item.points).map((point) => ({ point, kind: 'target' })));
    viewer.framePoints([rightPoint(item)], 90);
  } else {
    viewer.selectIds(item.ids);
    viewer.frameIds(oneSide(item.ids));
  }
}

const NAME_PROMPT = { muscles: 'Name the lit muscle', bones: 'Name the lit bone', landmarks: 'Name the marked landmark' };

function drawStudy(feedback = null, typed = '') {
  const study = state.study;
  const round = study.round;
  const item = currentItem(round);
  const actions = [];
  const naming = study.mode === 'name';
  if (!round.answered) {
    actions.push({ label: naming ? 'Show answer' : 'Show me', onClick: studyGiveUp });
    if (!naming && study.kind === 'muscles' && state.viewer.layerMap) {
      actions.push({ label: state.peelDepth ? `Peel: layer ${state.peelDepth}` : 'Peel a layer', onClick: () => { cyclePeel(true); drawStudy(feedback); } });
    }
  } else {
    actions.push({ label: round.index + 1 < round.items.length ? 'Next' : 'See score', primary: true, onClick: studyNext });
  }
  actions.push({ label: 'End', onClick: endStudy });
  const where = study.kind === 'landmarks' ? ` on the ${groupLabel('landmarks', study.region).toLowerCase()}` : '';
  ui.renderStudyBar({
    title: `${modeLabel(study.mode)} · ${kindLabel(study.kind)} · ${groupLabel(study.kind, study.region)}`,
    progress: `${round.index + 1} / ${round.items.length}`,
    prompt: naming ? `${NAME_PROMPT[study.kind]}${where}` : `Find: ${item.label}`,
    feedback,
    actions,
    answer: naming && !round.answered ? { onSubmit: studySubmitName, value: typed } : null,
  });
}

/** Plain name for whatever was tapped, for "that was the ..." feedback. */
function nameForId(id) {
  const item = itemForId(state.study.items, id);
  if (item) return item.label;
  const bone = classifyBone(id);
  if (bone) return boneBaseName(bone.display);
  const muscle = findMuscleRecord(state.data.muscleIndex, id);
  return muscle ? studyMuscleLabel(muscle.record.name) : 'a structure outside this set';
}

function studyTap(id, info = {}) {
  const study = state.study;
  if (!study || study.round.answered) return;
  if (study.mode === 'name') { ui.flashHint('Type the name in the box below.'); return; }
  if (study.kind === 'landmarks') { landmarkTap(id, info.point, info.normal); return; }
  // In a muscle round the bones are there for orientation; a bone tap is not
  // an answer.
  if (study.kind === 'muscles' && classifyBone(id)) {
    ui.flashHint(`That is the ${boneBaseName(classifyBone(id).display)} - tap a muscle.`);
    return;
  }
  const result = answerTap(study.round, id);
  if (!result) return;
  state.viewer.selectIds(result.item.ids);
  drawStudy(result.correct
    ? { text: 'Correct!', good: true }
    : { text: `Not quite - that was ${nameForId(id)}. ${result.item.label} is now lit.`, good: false });
}

function landmarkTap(id, point, normal) {
  const study = state.study;
  if (!study.allIds.includes(id)) {
    ui.flashHint(`Tap on the ${groupLabel('landmarks', study.region).toLowerCase()}.`);
    return;
  }
  const result = answerLandmarkTap(study.round, id, point, normal);
  if (!result) return;
  const target = result.item.points[id] || rightPoint(result.item);
  state.viewer.setMarkers([{ point: target, kind: 'target' }, ...(result.correct ? [] : [{ point, kind: 'tap' }])]);
  // A landmark facing away from the tapped surface is on the other side of the bone.
  const tn = result.item.normals?.[id];
  const behind = !result.correct && tn && normal && tn[0] * normal[0] + tn[1] * normal[1] + tn[2] * normal[2] < 0;
  const turn = behind ? ' It is on the other side of the bone - drag to turn it.' : '';
  drawStudy(result.correct
    ? { text: `Correct - ${result.item.label}.`, good: true }
    : { text: (result.nearest
        ? `Not quite - your tap (orange) is nearest the ${result.nearest.label}. The ${result.item.label} is the blue dot.`
        : `Not quite - your tap (orange) is not near a landmark on this card. The ${result.item.label} is the blue dot.`) + turn,
      good: false });
}

function studySubmitName(raw) {
  const study = state.study;
  if (!study || study.round.answered) return;
  const typed = sanitizeQuery(raw);
  const result = answerName(study.round, typed, study.naming);
  if (!result) return;
  if (result.pending) {
    if (result.verdict === 'vague') drawStudy({ text: `"${typed}" fits more than one structure here - give the full name.`, good: false }, typed);
    else ui.flashHint('Type a name first.');
    return;
  }
  const label = result.item.label;
  const text = {
    exact: `Correct - ${label}.`,
    close: `Half a point: you wrote "${typed}". Correct spelling: ${label}.`,
    other: `Not quite - "${typed}" is the ${result.other}. This is the ${label}.`,
    wrong: `Not quite - this is the ${label}.`,
  }[result.verdict];
  drawStudy({ text, good: result.verdict === 'exact' });
}

function studyGiveUp() {
  const study = state.study;
  const result = giveUp(study.round);
  if (!result) return;
  if (study.mode === 'name') { drawStudy({ text: `This is the ${result.item.label}.`, good: false }); return; }
  if (study.kind === 'landmarks') {
    state.viewer.setMarkers(Object.values(result.item.points).map((point) => ({ point, kind: 'target' })));
    drawStudy({ text: `The ${result.item.label} is the blue dot.`, good: false });
    return;
  }
  state.viewer.selectIds(result.item.ids);
  drawStudy({ text: `${result.item.label} is now lit.`, good: false });
}

function studyNext() {
  const study = state.study;
  state.viewer.selectIds([]);
  state.viewer.setMarkers([]);
  if (nextQuestion(study.round)) {
    drawStudy();
    if (study.mode === 'name') showNameQuestion();
    return;
  }
  const { correct, missed, items } = study.round;
  const total = items.length;
  const half = study.mode === 'name';
  const key = studyKey(study.kind, study.region, study.mode);
  const before = getStudyBest()[key];
  const isNewBest = recordStudyScore(study.kind, study.region, half ? Math.round(correct * 2) : correct, half ? total * 2 : total, study.mode);
  const prev = before ? (half ? `${formatPoints(before.best / 2)} / ${before.total / 2}` : `${before.best} / ${before.total}`) : '';
  const bestNote = !before ? ' First score saved.' : isNewBest ? ' New best!' : ` Best: ${prev}.`;
  const shown = missed.slice(0, 8).join(', ') + (missed.length > 8 ? `, and ${missed.length - 8} more` : '');
  ui.renderStudyBar({
    title: `${modeLabel(study.mode)} · ${kindLabel(study.kind)} · ${groupLabel(study.kind, study.region)}`,
    progress: 'Done',
    prompt: `Score: ${formatPoints(correct)} / ${total}.${bestNote}`,
    feedback: missed.length ? { text: `${half ? 'Not full marks' : 'Missed'}: ${shown}`, good: false } : { text: 'Perfect round!', good: true },
    actions: [
      { label: 'Again', primary: true, onClick: () => startStudy(study.kind, study.region, study.mode) },
      { label: 'Other set', onClick: openStudy },
      { label: 'Done', onClick: endStudy },
    ],
  });
}

/**
 * Leaving a round part-way loses it, so Escape, "/", Search and Study ask for
 * a second press first (team review 2026-11-03). A round not yet started, or
 * already finished, leaves at once. Not a modal dialog: a hint, and the same
 * key or button again within 4 s.
 */
function okToLeaveStudy() {
  const study = state.study;
  if (!study) return true;
  const round = study.round;
  const started = round.index > 0 || round.answered;
  const finished = round.index >= round.items.length || (round.index === round.items.length - 1 && round.answered);
  if (!started || finished || study.leaveArmedUntil > Date.now()) return true;
  study.leaveArmedUntil = Date.now() + 4000;
  ui.flashHint('This ends your round and loses its score. Press again to leave.');
  return false;
}

/** Leave study and put the model back the way the user had it. */
function endStudy() {
  const study = state.study;
  if (!study) return;
  state.study = null;
  ui.hideStudyBar();
  document.body.classList.remove('studying');
  updateViewInset();
  const viewer = state.viewer;
  if (!viewer) return;
  viewer.onSelect(show);
  viewer.setTapLayer(null);
  viewer.setStudyScope(null);
  viewer.setMarkers([]);
  viewer.selectIds([]);
  viewer.select(null);
  for (const [id, on] of Object.entries(study.saved.layers)) {
    state.layerVisibility[id] = on;
    viewer.setLayerVisible(id, on);
  }
  state.peelDepth = study.saved.peel;
  viewer.setPeelDepth(state.peelDepth);
  if (study.saved.xray !== state.xray) setXrayState(study.saved.xray);
  refreshLayers();
  viewer.resetView();
}

/* ------------------------------------------------------------------ menu */
// The dropdown that holds every control (2026-10-14). Toggles (layers, Both
// sides, X-ray, Deep view) leave it open so several can be flipped in a row;
// one-shot actions (Search, Recentre, Credits) close it.
function isMenuOpen() { return !byId('menu').hidden; }
function setMenu(open) {
  const menu = byId('menu');
  if (menu.hidden === !open) return;
  menu.hidden = !open;
  byId('menuBtn').setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
}

function wireMenu() {
  byId('menuBtn').addEventListener('click', () => setMenu(!isMenuOpen()));
  // Any press outside the menu closes it (including on the model itself).
  document.addEventListener('pointerdown', (event) => {
    if (isMenuOpen() && !event.target.closest('.menu-wrap')) setMenu(false);
  });
  for (const id of ['studyBtn', 'searchBtn', 'resetViewBtn', 'creditsBtn']) {
    byId(id).addEventListener('click', () => setMenu(false));
  }
}

function wireInterface() {
  wireMenu();
  byId('studyBtn').addEventListener('click', openStudy);
  byId('searchBtn').addEventListener('click', () => { if (!okToLeaveStudy()) return; endStudy(); ui.openSearch(); });
  byId('searchClose').addEventListener('click', ui.closeSearch);
  byId('infoClose').addEventListener('click', closeInfoPanel);

  byId('xrayBtn').addEventListener('click', () => setXrayState(!state.xray));

  // Bilateral / unilateral selection (2026-10-09). Remembered between visits.
  const sidesBtn = byId('sidesBtn');
  const paintSides = () => {
    sidesBtn.classList.toggle('active', state.bilateral);
    sidesBtn.setAttribute('aria-pressed', String(state.bilateral));
  };
  paintSides();
  sidesBtn.addEventListener('click', () => {
    state.bilateral = !state.bilateral;
    setBilateral(state.bilateral);
    paintSides();
    // Re-run show() so the card title matches what is now lit.
    const current = state.viewer?.selectedId;
    if (state.viewer) state.viewer.setBilateral(state.bilateral);
    if (current) show(current);
    ui.flashHint(state.bilateral ? 'Selecting both sides together.' : 'Selecting one side at a time.');
  });

  // Panning (added 2026-08-01) means the model can be dragged well off centre,
  // so there has to be a way back that does not involve hunting for it.
  byId('resetViewBtn').addEventListener('click', () => {
    state.viewer?.resetView();
    ui.flashHint('View recentered.');
  });

  const input = byId('searchInput');
  input.addEventListener('input', () => {
    const query = sanitizeQuery(input.value);
    ui.renderSearchResults(ui.filterIndex(state.searchIndex, query), query, showAndFocus);
  });

  // Credits screen (2026-10-08): the full attribution CC BY-SA requires.
  // Clearing stored data moved in here 2026-10-14 (off the phone top bar).
  // It also resets the Both sides toggle, since clearAll() forgets that
  // setting - otherwise the button would show "on" with nothing stored.
  byId('creditsBtn').addEventListener('click', () => ui.renderCredits({
    onClearData: () => {
      clearAll();
      if (state.bilateral) {
        state.bilateral = false;
        paintSides();
        state.viewer?.setBilateral(false);
      }
      ui.flashHint('Stored history cleared.');
    },
  }));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (isMenuOpen()) { setMenu(false); byId('menuBtn').focus(); return; }
      if (ui.closeCredits()) return;
      if (ui.closeStudyPicker()) return;
      if (state.study) { if (okToLeaveStudy()) endStudy(); return; }
      if (ui.isSearchOpen()) ui.closeSearch();
      else closeInfoPanel();
    }
    // "/" is the conventional focus-search shortcut; ignore it while typing.
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      event.preventDefault();
      setMenu(false);
      if (!okToLeaveStudy()) return;
      endStudy();
      ui.openSearch();
    }
  });

  const recents = getRecents();
  // Panning has no visible affordance, so first-time users are told once.
  if (recents.length) ui.flashHint(`Last viewed: ${recents[0]}`);
  else if (hasAcknowledgedDisclaimer()) firstRunHint();
}

function firstRunHint() {
  ui.flashHint('Tap a muscle or bone, or Menu > Search · drag to rotate · pinch or scroll to zoom', 6500);
}

/**
 * Anything that escapes a try/catch still reaches the user as plain language,
 * with the real error kept in the console for debugging.
 */
window.addEventListener('error', (event) => {
  ui.showError('The app hit an unexpected error. Reloading usually fixes it.', {
    detail: event.error || event.message,
  });
});
window.addEventListener('unhandledrejection', (event) => {
  ui.showError('The app hit an unexpected error. Reloading usually fixes it.', {
    detail: event.reason,
  });
});

boot();
