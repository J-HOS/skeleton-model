/**
 * ui.js — all rendering. Builds nodes via dom.js; never writes HTML strings.
 *
 * Every function here takes plain data and returns or fills DOM. It knows
 * nothing about three.js and nothing about fetching, which keeps the visual
 * layer easy to change without touching anything that could affect
 * correctness of the anatomy or the security posture.
 */

import { byId, clear, el, fieldRow, replace } from './dom.js?v=410801c52c48';
import { ATTRIBUTION, CREDITS, DISCLAIMER, LAYERS, LIMITS } from './config.js?v=410801c52c48';
import { parseLandmarkCard, prettyName } from './anatomy.js?v=410801c52c48';

/* ---------------------------------------------------------------- status -- */

export function setLoading(message) {
  const node = byId('loading');
  node.hidden = !message;
  if (message) replace(node, [el('div', { className: 'spinner' }), el('span', { text: message })]);
}

/**
 * Show a failure to the user in plain language. The technical detail goes to
 * the console; a stack trace on screen tells a physiotherapist nothing and
 * leaks internals.
 */
export function showError(message, { detail, onRetry } = {}) {
  if (detail) console.error(detail);
  setLoading(null);
  const panel = byId('error');
  replace(panel, [
    el('div', { className: 'error-card' }, [
      el('h2', { text: 'Something went wrong' }),
      el('p', { text: message }),
      el('button', {
        className: 'btn',
        text: onRetry ? 'Try again' : 'Reload',
        on: { click: onRetry || (() => location.reload()) },
      }),
    ]),
  ]);
  panel.hidden = false;
}

export function hideError() {
  byId('error').hidden = true;
}

/** Brief transient message in the corner. */
let hintTimer = null;
export function flashHint(message, ms = 2600) {
  const node = byId('hint');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { node.hidden = true; }, ms);
}

/* ---------------------------------------------------------------- layers -- */

export function renderLayers(state, onToggle, peel = null) {
  const buttons = LAYERS.map((layer) => {
      const available = state.available.has(layer.id);
      const on = available && state.visible[layer.id];
      return el(
        'button',
        {
          className: `layer-btn${on ? '' : ' off'}${available ? '' : ' unavailable'}`,
          attrs: {
            type: 'button',
            'aria-pressed': String(on),
            'aria-label': `${layer.label} layer`,
            disabled: available ? null : 'disabled',
          },
          on: { click: () => available && onToggle(layer.id) },
        },
        [
          // Colour comes from a fixed CSS class (styles.css), not an inline
          // `style` attribute — the app's CSP is style-src 'self' with no
          // unsafe-inline, so any inline style attribute is silently blocked
          // and logs a violation. Found 2026-07-31 while chasing an unrelated
          // report; pre-existing, not introduced this session.
          el('span', { className: `dot dot-${layer.id}` }),
          el('span', { text: layer.label }),
          available
            ? el('span', { className: 'switch', attrs: { 'aria-hidden': 'true' } })
            : el('span', { className: 'lock', text: 'soon' }),
        ]
      );
    });
  // Depth view control (2026-10-14). Offered only when the measured layers
  // loaded; each press peels the right side one layer deeper, then off.
  if (peel && peel.deepest >= 2) {
    const on = peel.depth >= 2;
    buttons.splice(2, 0, el(
      'button',
      {
        className: `layer-btn depth-btn${on ? '' : ' off'}`,
        attrs: {
          id: 'depthBtn',
          type: 'button',
          'aria-pressed': String(on),
          'aria-label': on
            ? `Deep view on the body's right side, layer ${peel.depth} of ${peel.deepest}. Press for the next layer.`
            : "Deep view off. Press to remove the surface muscles on the body's right side.",
        },
        on: { click: () => peel.onCycle() },
      },
      [
        el('span', { className: 'dot dot-depth' }),
        el('span', { text: 'Deep view' }),
        // A cycle, not an on/off: the value shows where it is in the cycle.
        el('span', { className: 'value', text: on ? `layer ${peel.depth} of ${peel.deepest}` : 'off' }),
      ]
    ));
  }
  replace(byId('layers'), buttons);
}

/* ------------------------------------------------------------ info panel -- */

function attributionNote() {
  return el('p', { className: 'attribution', text: ATTRIBUTION });
}

function reviewFlag(muscle) {
  const flag = muscle.review_flag;
  if (!flag || String(flag).trim() === '') return null;
  return el('div', {
    className: 'flag',
    text: `Flagged for review: ${flag}. Verify against Gray's Anatomy or Netter's before relying on this entry.`,
  });
}

const SIDE_LABEL = { left: ' (Left)', right: ' (Right)', both: ' (Both sides)' };

/** side: 'left' | 'right' | 'both' (bilateral selection) | null (midline). */
export function renderMuscle(muscle, side) {
  byId('infoTitle').textContent = prettyName(muscle.name) + (SIDE_LABEL[side] || '');
  byId('infoSub').textContent = `${muscle.section} · Muscle`;
  replace(byId('infoBody'), [
    fieldRow('Origin', muscle.origin),
    fieldRow('Insertion', muscle.insertion),
    fieldRow('Action', muscle.action),
    fieldRow('Nerve innervation', muscle.nerve_innervation),
    fieldRow('Notes', muscle.notes),
    reviewFlag(muscle),
    attributionNote(),
  ]);
  openInfo();
}

export function renderBone(bone, landmarkContent) {
  byId('infoTitle').textContent = bone.display;
  byId('infoSub').textContent = `${bone.region} · ${bone.type}`;

  const children = [];
  if (landmarkContent) {
    const rows = parseLandmarkCard(landmarkContent).map((item) =>
      item.kind === 'heading'
        ? el('div', { className: 'lm-head', text: item.text })
        : el('div', { className: 'lm' }, [
            el('span', { className: 'lm-key', text: item.key }),
            el('span', { text: item.text }),
          ])
    );
    children.push(
      el('div', { className: 'row' }, [
        el('div', { className: 'k', text: 'Bony landmarks' }),
        el('div', { className: 'lm-list' }, rows),
      ])
    );
  } else {
    children.push(
      el('div', { className: 'row' }, [
        el('div', { className: 'v muted', text: 'No landmark card for this bone yet.' }),
      ])
    );
  }
  children.push(attributionNote());
  replace(byId('infoBody'), children);
  openInfo();
}

export function openInfo() {
  byId('info').classList.add('open');
}

export function closeInfo() {
  byId('info').classList.remove('open');
}

/* ---------------------------------------------------------------- search -- */

/**
 * Filter by substring on a pre-lowercased haystack. The query is already
 * sanitised and is used as a literal — never compiled into a RegExp — so no
 * input can turn this into a pathological match.
 */
export function filterIndex(index, query) {
  if (!query) return [];
  const needle = query.toLowerCase();
  const starts = [];
  const contains = [];
  for (const item of index) {
    const at = item.haystack.indexOf(needle);
    if (at === 0) starts.push(item);
    else if (at > 0) contains.push(item);
    if (starts.length >= LIMITS.searchResults) break;
  }
  return [...starts, ...contains].slice(0, LIMITS.searchResults);
}

export function renderSearchResults(results, query, onPick) {
  const list = byId('searchResults');
  if (!query) {
    replace(list, [el('div', { className: 'search-empty', text: 'Type a muscle or bone name.' })]);
    return;
  }
  if (!results.length) {
    replace(list, [el('div', { className: 'search-empty', text: `No match for "${query}".` })]);
    return;
  }
  replace(
    list,
    results.map((item) =>
      el(
        'button',
        { className: 'result', attrs: { type: 'button' }, on: { click: () => onPick(item.id) } },
        [
          el('span', { className: 'result-name', text: item.name }),
          el('span', { className: 'result-sub', text: item.subtitle }),
        ]
      )
    )
  );
}

// Open/closed is the `hidden` attribute, not a CSS class (2026-10-15): the
// browser's own stylesheet honours it even when styles.css fails to load.
export function openSearch() {
  byId('search').hidden = false;
  byId('searchInput').focus();
}

export function closeSearch() {
  byId('search').hidden = true;
}

export function isSearchOpen() {
  return !byId('search').hidden;
}

/* ------------------------------------------------------------ disclaimer -- */

export function renderDisclaimer(onAcknowledge) {
  const panel = byId('disclaimer');
  replace(panel, [
    el('div', { className: 'error-card' }, [
      el('h2', { text: 'Before you start' }),
      el('p', { text: DISCLAIMER }),
      el('p', { className: 'attribution', text: ATTRIBUTION }),
      el('button', {
        className: 'btn',
        text: 'I understand',
        on: {
          click: () => {
            panel.hidden = true;
            onAcknowledge();
          },
        },
      }),
    ]),
  ]);
  panel.hidden = false;
}

/* --------------------------------------------------------------- credits -- */

/**
 * Full credits and licences (CC BY-SA attribution). Built from CREDITS in
 * config.js through el(), like everything else: text, never markup. Links open
 * in a new tab with no referrer, so leaving the app never leaks where from.
 */
export function renderCredits({ onClose, onClearData } = {}) {
  const panel = byId('credits');
  const close = () => { panel.hidden = true; onClose?.(); };
  // "Clear data" lives here since 2026-10-14 (it was the sixth top-bar button
  // and wrapped onto a row of its own on phones). It sits next to the
  // licences because both are "about this app", not part of studying.
  const clearBtn = onClearData ? el('button', {
    className: 'btn subtle',
    text: 'Clear stored data',
    attrs: { id: 'clearDataBtn', type: 'button', 'aria-label': 'Clear stored history and preferences' },
    on: { click: () => { onClearData(); clearBtn.textContent = 'Cleared'; clearBtn.disabled = true; } },
  }) : null;
  replace(panel, [
    el('div', { className: 'error-card credits-card', attrs: { role: 'dialog', 'aria-label': 'Credits and licenses' } }, [
      el('h2', { text: 'Credits and licenses' }),
      ...CREDITS.map((c) => el('section', { className: 'credit' }, [
        el('h3', { text: c.title }),
        el('p', { text: c.text }),
        c.note ? el('p', { className: 'credit-note', text: c.note }) : null,
        c.links ? el('p', { className: 'credit-links' }, c.links.flatMap(([label, href], i) => [
          i ? ' · ' : null,
          el('a', { text: label, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } }),
        ])) : null,
      ])),
      onClearData ? el('section', { className: 'credit credit-data' }, [
        el('h3', { text: 'Your data' }),
        el('p', { text: 'This app keeps your recent structures, your study scores, the first-run notice and the Both sides setting in this browser only, and runs no analytics. The site host (GitHub) keeps standard server logs, such as IP addresses.' }),
        clearBtn,
      ]) : null,
      el('button', { className: 'btn', text: 'Close', on: { click: close } }),
    ]),
  ]);
  panel.hidden = false;
}

export function closeCredits() {
  const panel = byId('credits');
  if (panel.hidden) return false;
  panel.hidden = true;
  return true;
}

/* ----------------------------------------------------------------- study -- */
// Study section, first version (2026-11-02): "Find it" by subject and region.
// The picker is a dialog over the model; during a round only a slim bar at
// the top is shown, so the model stays tappable.

/**
 * @param {object} o
 *   kinds, regions - from study.js
 *   counts(kind, region) -> number of questions
 *   best -> { "kind:region": { best, total } }
 *   kind - the subject tab to show first
 *   onStart(kind, region), onClose()
 */
export function renderStudyPicker({ kinds, regions, counts, best, kind, onStart, onClose }) {
  const panel = byId('study');
  let current = kind || kinds[0].id;
  const close = () => { panel.hidden = true; onClose?.(); };
  const draw = () => {
    const tabs = el('div', { className: 'study-tabs', attrs: { role: 'tablist', 'aria-label': 'Subject' } },
      kinds.map((k) => el('button', {
        className: 'study-tab' + (k.id === current ? ' active' : ''),
        text: k.label,
        attrs: { type: 'button', role: 'tab', 'aria-selected': String(k.id === current) },
        on: { click: () => { current = k.id; draw(); } },
      })));
    const list = el('div', { className: 'study-regions' }, regions.map((r) => {
      const n = counts(current, r.id);
      const b = best[`${current}:${r.id}`];
      return el('button', {
        className: 'study-region',
        attrs: { type: 'button', 'aria-label': `${r.label}: ${n} to find${b ? `, best ${b.best} of ${b.total}` : ''}` },
        on: { click: () => { if (n) { panel.hidden = true; onStart(current, r.id); } } },
      }, [
        el('span', { className: 'study-region-name', text: r.label }),
        el('span', { className: 'study-region-meta', text: b ? `${n} · best ${b.best}/${b.total}` : `${n}` }),
      ]);
    }));
    replace(panel, [
      el('div', { className: 'error-card study-card', attrs: { role: 'dialog', 'aria-label': 'Study' } }, [
        el('h2', { text: 'Study: Find it' }),
        el('p', { text: 'Pick a region. The app names a structure; tap it on the model. Either side counts.' }),
        el('p', { className: 'study-note', text: current === 'muscles'
          ? 'Early version: answer by tapping; a list option is coming. Scapula movers are under Thorax. Eight deep throat and jaw muscles are not asked yet, because they cannot be seen from outside.'
          : 'Early version: answer by tapping; a list option is coming. Wrist bones are under Hand; ankle bones are under Foot.' }),
        tabs,
        list,
        el('button', { className: 'btn subtle', text: 'Close', attrs: { type: 'button' }, on: { click: close } }),
      ]),
    ]);
  };
  draw();
  panel.hidden = false;
}

export function closeStudyPicker() {
  const panel = byId('study');
  if (panel.hidden) return false;
  panel.hidden = true;
  return true;
}

/**
 * The bar shown during a round.
 * @param {object} o
 *   title - e.g. "Muscles · Upper arm"; progress - "3 / 12"
 *   prompt - the question line; feedback - { text, good } or null
 *   actions - [{ label, onClick, primary }]
 */
export function renderStudyBar({ title, progress, prompt, feedback, actions }) {
  const bar = byId('studyBar');
  replace(bar, [
    el('div', { className: 'study-bar-head' }, [
      el('span', { className: 'study-bar-title', text: title }),
      el('span', { className: 'study-bar-progress', text: progress || '' }),
    ]),
    el('p', { className: 'study-bar-prompt', text: prompt, attrs: { 'aria-live': 'polite' } }),
    feedback ? el('p', {
      className: 'study-bar-feedback ' + (feedback.good ? 'good' : 'bad'),
      text: feedback.text,
      attrs: { role: 'status' },
    }) : null,
    el('div', { className: 'study-bar-actions' }, actions.map((a) => el('button', {
      className: 'btn' + (a.primary ? '' : ' subtle'),
      text: a.label,
      attrs: { type: 'button' },
      on: { click: a.onClick },
    }))),
  ]);
  bar.hidden = false;
}

export function hideStudyBar() {
  byId('studyBar').hidden = true;
}
