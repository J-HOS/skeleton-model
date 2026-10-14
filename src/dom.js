/**
 * dom.js — the only module allowed to touch the DOM structurally.
 *
 * Every node in this app is built here, and text always goes in via
 * textContent. Nothing in the codebase assigns innerHTML or outerHTML, and
 * nothing builds an HTML string. That single rule is what makes cross-site
 * scripting structurally impossible rather than merely escaped-against:
 * anatomical text, mesh names and search input are all data, never markup.
 *
 * There is a test in test/run-tests.mjs that greps the source for innerHTML
 * and fails the build if it reappears.
 */

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [props] - className, text, attrs, dataset, on (listeners)
 * @param {Array<Node|string>} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text != null) node.textContent = String(props.text);
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v != null) node.setAttribute(k, String(v));
    }
  }
  if (props.dataset) {
    for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = String(v);
  }
  if (props.on) {
    for (const [event, handler] of Object.entries(props.on)) {
      node.addEventListener(event, handler);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Remove all children of a node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace a node's contents with the given children in one pass. */
export function replace(node, children) {
  clear(node);
  const frag = document.createDocumentFragment();
  for (const child of children) {
    if (child == null) continue;
    frag.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  node.appendChild(frag);
}

/** Shorthand for document.getElementById with a clear failure. */
export function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node;
}

/** A labelled key/value row in the info panel. Returns null for empty values. */
export function fieldRow(label, value) {
  if (value == null || String(value).trim() === '') return null;
  return el('div', { className: 'row' }, [
    el('div', { className: 'k', text: label }),
    el('div', { className: 'v', text: value }),
  ]);
}
