/**
 * devpanel.js — a localhost-only A/B panel for appearance decisions.
 *
 * Why this exists. Three appearance changes shipped on 2026-08-01 having been
 * reasoned about and rendered in Blender but never seen in the app itself: the
 * four BONE_SURFACE_COLORS, the per-muscle shade variance, and the muscle/bone
 * roughness split. They sat in Next Up as "eyes-on checks pending" because
 * judging them meant edit config.js, restart, squint, repeat — and the last
 * time this project tried that, most of a session went to "I changed a number,
 * does it look different now?" before the real cause turned up elsewhere
 * (2026-07-31, the emissive bug).
 *
 * A toggle you can flick while looking at the model answers in seconds what a
 * restart cycle answers in ten minutes, and more honestly: flipping an A/B back
 * and forth defeats the eye's habit of adapting to whatever it has been staring
 * at. Each control's OFF position is the real previous appearance, not an
 * invented neutral — an A/B is only worth trusting if its baseline is what
 * actually shipped before.
 *
 * Scope. This is a development instrument, not a product feature: it is gated
 * to loopback hosts and never mounts anywhere else. It builds its own DOM
 * through dom.js, so the no-innerHTML rule and the strict CSP hold here exactly
 * as everywhere else — no inline styles, no inline handlers, every colour and
 * position in styles.css.
 */

import { el, replace } from './dom.js?v=7aa0c8ce5a6e';
import { BONE_SURFACE_COLORS, RENDER } from './config.js?v=7aa0c8ce5a6e';
import { scaleChannels } from './anatomy.js?v=7aa0c8ce5a6e';

/**
 * A visible, dated build stamp. The one technique that reliably settled "is the
 * browser even running my new code?" on this project was putting a marker on
 * screen and having it read back verbatim after a hard restart — file
 * timestamps and DevTools both proved less conclusive (2026-07-31).
 */
export const DEV_BUILD = '2026-08-02b · attachment tint';

/**
 * Loopback only. `''` covers file:// where hostname is empty. If this is ever
 * served from a real host the panel simply does not exist.
 */
const DEV_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]', ''];

export function isDevHost(hostname) {
  const host = hostname ?? (typeof location === 'undefined' ? null : location.hostname);
  return DEV_HOSTS.includes(String(host ?? ''));
}

/** #rrggbb, so a value can be read off the screen and pasted into config.js. */
export function hexString(value) {
  return `#${(value >>> 0).toString(16).padStart(6, '0')}`;
}

/**
 * Current settings written as the config.js changes they imply. The point of
 * the panel is to end with values worth keeping, so it has to say plainly what
 * keeping them would mean.
 */
export function summarise(tuning) {
  const suture = scaleChannels(BONE_SURFACE_COLORS.suture, tuning.sutureTone);
  return [
    tuning.boneSurfaces
      ? `BONE_SURFACE_COLORS.suture: 0x${hexString(suture).slice(1)}`
      : 'BONE_SURFACE_COLORS: off (every slot flattened to COLORS.bone)',
    `RENDER.muscleShadeVariance: ${tuning.shadeVariance.toFixed(3)}`,
    tuning.roughnessSplit
      ? `roughness: bone ${RENDER.boneRoughness} / muscle ${RENDER.muscleRoughness}`
      : `roughness: flat ${RENDER.flatRoughness} (pre-split)`,
    `RENDER.attachmentTint: ${tuning.attachmentTint.toFixed(2)}`,
    `RENDER.attachmentSpan: ${tuning.attachmentSpan.toFixed(2)}`,
    `RENDER.attachmentTaperMax: ${tuning.attachmentTaperMax.toFixed(2)}`,
  ].join('\n');
}

/* Each row returns its node plus a reset() so "back to config.js" snaps the
 * controls themselves back, not just the scene. A reset that leaves the
 * sliders showing stale numbers is worse than none — it makes the readout lie. */

function toggleRow(label, hint, initial, onChange) {
  const input = el('input', {
    className: 'dev-check',
    attrs: { type: 'checkbox', ...(initial ? { checked: 'checked' } : {}) },
    on: { change: (event) => onChange(event.target.checked) },
  });
  const node = el('label', { className: 'dev-row' }, [
    input,
    el('span', { className: 'dev-text' }, [
      el('span', { className: 'dev-label', text: label }),
      el('span', { className: 'dev-hint', text: hint }),
    ]),
  ]);
  return { node, reset: () => { input.checked = initial; } };
}

function sliderRow(label, hint, { min, max, step, value, format }, onChange) {
  const readout = el('span', { className: 'dev-value', text: format(value) });
  const input = el('input', {
    className: 'dev-range',
    attrs: {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
    },
    on: {
      input: (event) => {
        const next = Number(event.target.value);
        readout.textContent = format(next);
        onChange(next);
      },
    },
  });
  const node = el('div', { className: 'dev-row dev-row-stack' }, [
    el('span', { className: 'dev-text' }, [
      el('span', { className: 'dev-label', text: label }),
      el('span', { className: 'dev-hint', text: hint }),
    ]),
    el('div', { className: 'dev-slider' }, [input, readout]),
  ]);
  return {
    node,
    reset: () => {
      input.value = String(value);
      readout.textContent = format(value);
    },
  };
}

/**
 * Build and attach the panel. Returns null on a non-loopback host, so callers
 * can mount unconditionally and let the gate decide.
 *
 * @param {object} viewer - anything with a retune() and a tuning object
 * @param {HTMLElement} [host]
 */
export function mountDevPanel(viewer, host = document.body) {
  if (!isDevHost() || !viewer) return null;

  const defaults = { ...viewer.tuning };
  const state = { ...viewer.tuning };
  const readout = el('pre', { className: 'dev-readout' });

  // Attachment tinting rewrites a vertex-colour buffer for every muscle mesh,
  // which is far more work than recolouring a material. Coalescing to one apply
  // per animation frame means a fast drag does the work once per frame instead
  // of once per input event, so the slider stays honest about what it is doing
  // rather than lagging behind the pointer.
  let queued = false;
  const apply = () => {
    readout.textContent = summarise(state);
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      viewer.retune(state);
    });
  };

  const set = (key) => (value) => {
    state[key] = value;
    apply();
  };

  const rows = [
    toggleRow(
      'Bone surface colours',
      'Off flattens sutures, cartilage and enamel back to one bone colour.',
      defaults.boneSurfaces,
      set('boneSurfaces')
    ),
    sliderRow(
      'Suture tone',
      'Darker or lighter than the config value. Judge on the skull at normal distance.',
      {
        min: 0.55,
        max: 1.35,
        step: 0.01,
        value: defaults.sutureTone,
        format: (v) => `×${v.toFixed(2)}  ${hexString(scaleChannels(BONE_SURFACE_COLORS.suture, v))}`,
      },
      set('sutureTone')
    ),
    sliderRow(
      'Muscle shade variance',
      'Per-muscle lightness spread. Judge on the quadriceps or the hamstring group.',
      {
        min: 0,
        max: 0.3,
        step: 0.005,
        value: defaults.shadeVariance,
        format: (v) => v.toFixed(3),
      },
      set('shadeVariance')
    ),
    toggleRow(
      'Roughness split',
      `Off puts bone and muscle back on one finish (${RENDER.flatRoughness}).`,
      defaults.roughnessSplit,
      set('roughnessSplit')
    ),
    sliderRow(
      'Attachment tinting',
      'Fades each muscle’s ends toward tendon. Axis heuristic — it cannot tell origin from insertion, and will not follow a curved muscle.',
      {
        min: 0,
        max: 1,
        step: 0.02,
        value: defaults.attachmentTint,
        format: (v) => v.toFixed(2),
      },
      set('attachmentTint')
    ),
    sliderRow(
      'Attachment span',
      'How much of each end counts as tendon. Judge on biceps or gastrocnemius, where the real tendon is long and obvious.',
      {
        min: 0.05,
        max: 0.45,
        step: 0.01,
        value: defaults.attachmentSpan,
        format: (v) => `${(v * 100).toFixed(0)}% each end`,
      },
      set('attachmentSpan')
    ),
    sliderRow(
      'Attachment taper limit',
      'Muscles that do not narrow into their ends are skipped above this. Drag it to 1.6 to see what the gate is excluding — pectoralis and the finger flexors are the ones to watch.',
      {
        min: 0.4,
        max: 1.6,
        step: 0.02,
        value: defaults.attachmentTaperMax,
        format: (v) => v.toFixed(2),
      },
      set('attachmentTaperMax')
    ),
  ];

  const resetButton = el('button', {
    className: 'dev-reset',
    attrs: { type: 'button' },
    text: 'Reset to config.js',
    on: {
      click: () => {
        Object.assign(state, defaults);
        for (const row of rows) row.reset();
        apply();
      },
    },
  });

  const body = el('div', { className: 'dev-body' });
  replace(body, [...rows.map((row) => row.node), readout, resetButton]);

  const collapse = el('button', {
    className: 'dev-collapse',
    attrs: { type: 'button', 'aria-expanded': 'true', 'aria-label': 'Collapse tuning panel' },
    text: '−',
  });

  const panel = el(
    'aside',
    { className: 'dev-panel', attrs: { 'aria-label': 'Appearance tuning (development)' } },
    [
      el('div', { className: 'dev-head' }, [
        el('span', { className: 'dev-title', text: 'Tuning' }),
        el('span', { className: 'dev-build', text: DEV_BUILD }),
        collapse,
      ]),
      body,
    ]
  );

  collapse.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    collapse.textContent = collapsed ? '+' : '−';
    collapse.setAttribute('aria-expanded', String(!collapsed));
  });

  readout.textContent = summarise(state);
  host.appendChild(panel);
  return panel;
}
