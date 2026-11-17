/* UI helpers: element builder, icons, toasts, popovers and dialogs. Text always goes in with textContent. */
(function () {
  'use strict';
  const W = window.Wapiro;
  const UI = (W.ui = {});

  /** h('div', { class: 'x', onclick: fn, 'aria-label': 'y' }, child, 'text') */
  UI.h = function (tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  const h = UI.h;

  // Icons: inline SVG, mono, 1.5px stroke, drawn here. Static markup only (no user data).
  const ICONS = {
    restart: '<path d="M5 4v12"/><path d="M15 5l-7 5 7 5z"/>',
    prev: '<path d="M10 5l-7 5 7 5z"/><path d="M17 5l-7 5 7 5z"/>',
    next: '<path d="M10 5l7 5-7 5z"/><path d="M3 5l7 5-7 5z"/>',
    wait: '<path d="M5 2.5h10"/><path d="M5 17.5h10"/><path d="M5.83 2.5C5.83 6.67 9.73 8.84 9.73 10.15C9.73 11.25 5.83 13.33 5.83 17.5"/><path d="M14.17 2.5C14.17 6.67 10.27 9.8 10.27 9.8C10.27 9.8 14.17 13.33 14.17 17.5"/>',
    metronome: '<path d="M7 3h6l3 14H4z"/><path d="M4.8 13.5h10.4"/><path d="M10 13.5l4-8"/>',
    speakerOff: '<path d="M3 8h3l4-3.5v11L6 12H3z"/><path d="M13 7.5l5 5"/><path d="M18 7.5l-5 5"/>',
    piano: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M7 4v12"/><path d="M10 4v12"/><path d="M13 4v12"/><path d="M6 4h2v6H6z" fill="currentColor"/><path d="M12 4h2v6h-2z" fill="currentColor"/>',
    play: '<path d="M6 4l10 6-10 6z"/>',
    pause: '<path d="M6.5 4v12"/><path d="M13.5 4v12"/>',
    sliders: '<path d="M3 6h8"/><path d="M15 6h2"/><circle cx="13" cy="6" r="2"/><path d="M3 14h2"/><path d="M9 14h8"/><circle cx="7" cy="14" r="2"/>',
    speaker: '<path d="M3 8h3l4-3.5v11L6 12H3z"/><path d="M13 7.5a3.5 3.5 0 010 5"/><path d="M15 5.5a6.5 6.5 0 010 9"/>',
    more: '<circle cx="4.5" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="15.5" cy="10" r="1"/>',
    close: '<path d="M5 5l10 10"/><path d="M15 5L5 15"/>',
    check: '<path d="M4 10.5l4 4 8-9"/>',
    alert: '<path d="M10 3l8 14H2z"/><path d="M10 8v4"/><path d="M10 14.5v.5"/>',
    minus: '<path d="M4 10h12"/>',
    sparkle: '<path d="M9 3l1.6 4.4L15 9l-4.4 1.6L9 15l-1.6-4.4L3 9l4.4-1.6z"/><path d="M15.5 13v4"/><path d="M13.5 15h4"/>',
    widthArrows: '<path d="M2 10h16"/><path d="M5 7l-3 3 3 3"/><path d="M15 7l3 3-3 3"/>',
    plus: '<path d="M4 10h12"/><path d="M10 4v12"/>',
    chevron: '<path d="M6 8l4 4 4-4"/>',
    grip: '<circle cx="7.5" cy="5" r="1"/><circle cx="12.5" cy="5" r="1"/><circle cx="7.5" cy="10" r="1"/><circle cx="12.5" cy="10" r="1"/><circle cx="7.5" cy="15" r="1"/><circle cx="12.5" cy="15" r="1"/>',
    trash: '<path d="M4 6h12"/><path d="M8 6V4h4v2"/><path d="M5.5 6l1 10h7l1-10"/>',
    edit: '<path d="M4 16l1-4 8-8 3 3-8 8z"/><path d="M11.5 5.5l3 3"/>',
    download: '<path d="M10 3v10"/><path d="M6 9l4 4 4-4"/><path d="M4 16h12"/>',
    keyboard: '<rect x="2" y="5" width="16" height="10" rx="1.5"/><path d="M5 8h.01"/><path d="M8.5 8h.01"/><path d="M12 8h.01"/><path d="M15 8h.01"/><path d="M6 11.5h8"/>',
    loop: '<path d="M14 3l3 3-3 3"/><path d="M3 10V8.5A2.5 2.5 0 015.5 6H17"/><path d="M6 17l-3-3 3-3"/><path d="M17 10v1.5a2.5 2.5 0 01-2.5 2.5H3"/>',
    upload: '<path d="M10 14V4"/><path d="M6 8l4-4 4 4"/><path d="M4 16h12"/>',
    search: '<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>',
    x: '<path d="M6 6l8 8"/><path d="M14 6l-8 8"/>',
    file: '<path d="M6 3h6l3 3v11H6z"/><path d="M12 3v3h3"/>',
    undo: '<path d="M7 5L4 8l3 3"/><path d="M4 8h8a4 4 0 010 8H9"/>',
    redo: '<path d="M13 5l3 3-3 3"/><path d="M16 8H8a4 4 0 000 8h3"/>',
    music: '<path d="M8 15V5l8-2v10"/><circle cx="6" cy="15" r="2"/><circle cx="14" cy="13" r="2"/>',
  };
  UI.icon = function (name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.5'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  };

  // ---- toasts
  let toastBox = null;
  UI.mountToasts = function (parent) {
    toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' });
    parent.appendChild(toastBox);
    while (W._pendingNotes.length) { const [m, k] = W._pendingNotes.shift(); UI.toast(m, k); }
  };
  UI.toast = function (msg, kind, opts) {
    if (!toastBox) { W._pendingNotes.push([msg, kind]); return null; }
    const err = kind === 'error';
    const t = h('div', { class: 'toast ds-popover' + (err ? ' is-error' : ''), role: err ? 'alert' : 'status' },
      err ? UI.icon('alert') : null, h('span', { class: 'toast-text', text: msg }));
    const close = () => { t.remove(); };
    if (opts && opts.action) t.append(h('button', { class: 'ds-btn ds-btn--ghost', onclick: () => { opts.action.run(); close(); } }, opts.action.label));
    t.append(h('button', { class: 'ds-btn ds-btn--ghost ds-btn--icon', 'aria-label': 'Dismiss', onclick: close }, UI.icon('close')));
    toastBox.appendChild(t);
    while (toastBox.children.length > 4) toastBox.firstChild.remove();
    if (!err) setTimeout(close, (opts && opts.ms) || 5000);
    return t;
  };
  W.notify = (msg, kind) => UI.toast(msg, kind);

  // ---- popovers (non-modal): close on Esc or an outside press, focus returns to the button that opened them
  let current = null;
  UI.closePopover = function (restoreFocus) {
    if (!current) return false;
    const { el, anchor, onClose } = current;
    current = null;
    el.remove();
    if (anchor) { anchor.setAttribute('aria-expanded', 'false'); if (restoreFocus !== false) anchor.focus({ preventScroll: true }); }
    if (onClose) onClose();
    return true;
  };
  UI.openPopover = function (anchor, content, opts) {
    opts = opts || {};
    const same = current && current.anchor === anchor;
    UI.closePopover(false);
    if (same) return null;
    const el = h('div', { class: 'popover ds-popover', role: opts.role || 'dialog', 'aria-label': opts.label || '' }, content);
    document.getElementById('app').appendChild(el);
    anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect();
    const pw = el.offsetWidth, ph = el.offsetHeight;
    let left = opts.align === 'left' ? r.left : r.right - pw;
    left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
    el.style.left = left + 'px'; el.style.top = top + 'px';
    current = { el, anchor, onClose: opts.onClose };
    return el;
  };
  UI.popoverEl = () => (current ? current.el : null);
  document.addEventListener('pointerdown', (e) => {
    if (!current) return;
    if (current.el.contains(e.target) || (current.anchor && current.anchor.contains(e.target))) return;
    UI.closePopover(false);
  }, true);

  // ---- modal dialogs: trap focus, close on Esc
  let dlg = null;
  UI.closeDialog = function () {
    if (!dlg) return false;
    const { back, prev, onClose } = dlg; dlg = null; back.remove();
    if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
    if (onClose) onClose();
    return true;
  };
  /** Modal dialog. buttons: [{ label, primary, run, keepOpen }] or null for none. opts: { cls, onClose, head } */
  UI.openDialog = function (title, content, buttons, opts) {
    opts = opts || {};
    UI.closePopover(false);
    UI.closeDialog();
    const prev = document.activeElement;
    const btns = buttons === null ? [] : (buttons || [{ label: 'Close', primary: false }]);
    const box = h('div', { class: 'dialog ds-card' + (opts.cls ? ' ' + opts.cls : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'dialog-head' }, h('h2', { class: 'ds-h2', text: title }), opts.head || null,
        h('button', { class: 'ds-btn ds-btn--ghost ds-btn--icon', type: 'button', 'aria-label': 'Close', onclick: () => UI.closeDialog() }, UI.icon('close'))),
      h('div', { class: 'dialog-body' }, content),
      btns.length ? h('div', { class: 'dialog-actions' }, btns.map((b) =>
        h('button', { class: 'ds-btn ' + (b.primary ? 'ds-btn--primary' : b.danger ? 'ds-btn--destructive' : 'ds-btn--outline'), type: 'button', onclick: () => { if (!b.keepOpen) UI.closeDialog(); if (b.run) b.run(); } }, b.label))) : null);
    const back = h('div', { class: 'dialog-back' }, box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) UI.closeDialog(); });
    document.getElementById('app').appendChild(back);
    dlg = { back, box, prev, onClose: opts.onClose };
    const f = box.querySelector(opts.focus || '.dialog-body input, .dialog-body button, .dialog-actions .ds-btn--primary, .dialog-actions button') || box.querySelector('button');
    if (f) f.focus();
    return box;
  };
  UI.dialogOpen = () => !!dlg;
  document.addEventListener('keydown', (e) => {
    if (!dlg || e.key !== 'Tab') return;
    const f = [...dlg.box.querySelectorAll('button, input, select, a[href], [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!dlg.box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  });

  // ---- controls shared by the popovers
  UI.seg = function (label, items, value, onPick) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    const btns = items.map(([v, text]) => {
      const b = h('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': String(v === value), onclick: (e) => { onPick(v); if (e.detail > 0) b.blur(); } }, text);
      b.dataset.v = String(v);
      return b;
    });
    btns.forEach((b) => wrap.appendChild(b));
    wrap.setValue = (v) => btns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === String(v))));
    return wrap;
  };
  UI.switchBtn = function (label, value, onToggle, hint) {
    const sw = h('span', { class: 'ds-switch' + (value ? ' is-on' : ''), 'aria-hidden': 'true' });
    const b = h('button', { type: 'button', class: 'switch-row', role: 'switch', 'aria-checked': String(!!value), onclick: (e) => { onToggle(b.getAttribute('aria-checked') !== 'true'); if (e.detail > 0) b.blur(); } },
      h('span', { class: 'switch-text' }, h('span', { class: 'ds-label', text: label }), hint ? h('span', { class: 'ds-caption', text: hint }) : null), sw);
    b.setValue = (v) => { b.setAttribute('aria-checked', String(!!v)); sw.classList.toggle('is-on', !!v); };
    return b;
  };
  /** A pressed/unpressed toggle button with an icon and a label (Sound menu). */
  UI.toggleBtn = function (icon, label, value, onToggle) {
    const b = h('button', { type: 'button', class: 'ds-btn ds-btn--outline pop-toggle', 'aria-pressed': String(!!value), onclick: (e) => { onToggle(b.getAttribute('aria-pressed') !== 'true'); if (e.detail > 0) b.blur(); } }, UI.icon(icon), h('span', { text: label }));
    b.setValue = (v) => b.setAttribute('aria-pressed', String(!!v));
    return b;
  };
  /** A compact labelled range input for tool strips. */
  UI.miniSlider = function (label, min, max, step, value, onInput) {
    const inp = h('input', { type: 'range', class: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    const fill = () => inp.style.setProperty('--fill', ((inp.value - min) / (max - min)) * 100 + '%');
    inp.addEventListener('input', () => { fill(); onInput(+inp.value); });
    fill();
    const wrap = h('label', { class: 'mini-slider' }, h('span', { class: 'ds-caption', text: label }), inp);
    wrap.setValue = (v) => { inp.value = String(v); fill(); };
    return wrap;
  };
  UI.slider = function (label, min, max, step, value, onInput, fmt) {
    const out = h('span', { class: 'ds-caption slider-val' });
    const inp = h('input', { type: 'range', class: 'range', min, max, step, 'aria-label': label });
    const set = (v) => { inp.value = v; inp.style.setProperty('--fill', ((v - min) / (max - min)) * 100 + '%'); out.textContent = fmt ? fmt(+v) : String(v); };
    inp.addEventListener('input', () => { set(+inp.value); onInput(+inp.value); });
    inp.addEventListener('change', () => inp.blur());
    set(value);
    const row = h('div', { class: 'ds-field' }, h('div', { class: 'row-between' }, h('span', { class: 'ds-label', text: label }), out), inp);
    row.setValue = set;
    return row;
  };
})();
