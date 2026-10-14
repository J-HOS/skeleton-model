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

import { LAYERS, PATHS } from './config.js';
import { loadDataset, buildSearchIndex } from './dataset.js';
import { classifyBone, deepestLayer, findMuscleRecord, nextPeelDepth, parseLayerMap } from './anatomy.js';
import { fetchLocal, sanitizeQuery } from './security.js';
import { getRecents, pushRecent, hasAcknowledgedDisclaimer, acknowledgeDisclaimer, clearAll, getBilateral, setBilateral } from './storage.js';
import { Viewer } from './viewer.js';
import { mountDevPanel } from './devpanel.js';
import { byId } from './dom.js';
import * as ui from './ui.js';

const state = {
  data: null,
  viewer: null,
  searchIndex: [],
  layerVisibility: Object.fromEntries(LAYERS.map((l) => [l.id, l.id === 'skeleton'])),
  xray: false,
  bilateral: getBilateral(),
  peelDepth: 0,
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

/** Selecting from search also frames the structure, since it may be off-screen. */
function showAndFocus(structureId) {
  ui.closeSearch();
  show(structureId);
  if (state.viewer && !state.viewer.focus(structureId)) {
    ui.flashHint('Content shown — no mesh for this structure in the model yet.');
  }
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
function cyclePeel() {
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

async function boot() {
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

  ui.setLoading('Loading the 3D model…');
  state.viewer = new Viewer(byId('canvas-host'), state.data.muscleIndex);
  state.viewer.onSelect(show);
  state.viewer.bilateral = state.bilateral;

  try {
    const added = await state.viewer.load(PATHS.model, { replace: true });
    for (const [id, visible] of Object.entries(state.layerVisibility)) {
      state.viewer.setLayerVisible(id, visible);
    }
    indexBones();
    await loadLayerMap();
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

  if (!hasAcknowledgedDisclaimer()) ui.renderDisclaimer(acknowledgeDisclaimer);
}

/**
 * Closing the detail panel also clears the 3D selection, which un-dims the
 * rest of the model (see Viewer.select in viewer.js). Without this, once a
 * user picked a structure the model would stay dimmed with no way back to
 * a normal view short of picking something else.
 */
function closeInfoPanel() {
  ui.closeInfo();
  state.viewer?.select(null);
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
  for (const id of ['searchBtn', 'resetViewBtn', 'creditsBtn']) {
    byId(id).addEventListener('click', () => setMenu(false));
  }
}

function wireInterface() {
  wireMenu();
  byId('searchBtn').addEventListener('click', ui.openSearch);
  byId('searchClose').addEventListener('click', ui.closeSearch);
  byId('infoClose').addEventListener('click', closeInfoPanel);

  byId('xrayBtn').addEventListener('click', () => {
    state.xray = !state.xray;
    state.viewer?.setXray(state.xray);
    const btn = byId('xrayBtn');
    btn.classList.toggle('active', state.xray);
    btn.setAttribute('aria-pressed', String(state.xray));
  });

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
    ui.flashHint('View recentred.');
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
      if (ui.isSearchOpen()) ui.closeSearch();
      else closeInfoPanel();
    }
    // "/" is the conventional focus-search shortcut; ignore it while typing.
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
      event.preventDefault();
      setMenu(false);
      ui.openSearch();
    }
  });

  const recents = getRecents();
  // Panning has no visible affordance, so first-time users are told once.
  if (recents.length) ui.flashHint(`Last viewed: ${recents[0]}`);
  else ui.flashHint('Drag to rotate · two fingers or right-drag to move · pinch or scroll to zoom', 5200);
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
