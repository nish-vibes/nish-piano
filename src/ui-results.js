/* Results panel after a Practice run, loop-pass notices, and the first-run hint. */
(function () {
  'use strict';
  const W = window.Wapiro, E = W.engine, UI = W.ui, h = UI.h, S = W.storage;
  const R = (W.results = { open: false });

  const pct = (v) => Math.round(v * 100) + '%';
  function barAcc(b) { const t = b.hit + b.missed + b.wrong; return t ? b.hit / t : null; }

  /** The weakest stretch of bars: the worst bar plus weak neighbours, at most four bars. */
  R.weakRange = function (bars) {
    let worst = -1, wv = 2;
    bars.forEach((b, i) => { const a = barAcc(b); if (a != null && a < wv) { wv = a; worst = i; } });
    if (worst < 0 || wv >= 0.999) return null;
    let a = worst, z = worst;
    const weak = (i) => { const v = barAcc(bars[i]); return v != null && v < 0.9; };
    while (z - a < 3 && a > 0 && weak(a - 1)) a--;
    while (z - a < 3 && z + 1 < bars.length && weak(z + 1)) z++;
    return { from: a + 1, to: z + 1 };
  };

  R.show = function (res) {
    res = res || E.lastResult;
    const stat = (icon, word, n, cls) => h('div', { class: 'res-stat ' + cls }, UI.icon(icon), h('span', { class: 'ds-control-text', text: word }), h('span', { class: 'res-n ds-tabular', text: String(n) }));
    const body = h('div', { class: 'results' });
    const scored = res && res.kind === 'song' && res.valid && res.accuracy != null;
    if (!res || res.accuracy == null) {
      body.append(h('p', { class: 'ds-reading', text: 'Not enough played to score.' }), h('p', { class: 'ds-caption', text: 'Play the song in Practice mode from the first bar to the end to get a score.' }));
      UI.openDialog('Results', body, [{ label: 'Close' }], { onClose: () => { R.open = false; E.resultsOpen = false; } });
      R.open = true; E.resultsOpen = true;
      return;
    }
    body.append(
      h('div', { class: 'res-top' },
        h('div', { class: 'res-big ds-tabular', text: scored ? pct(res.accuracy) : '–' }),
        h('div', { class: 'res-sub' },
          h('div', { class: 'ds-control-text', text: scored ? 'Accuracy' : 'Not enough played to score.' }),
          h('div', { class: 'ds-caption', text: scored ? (res.saved ? 'New best score.' : res.best != null ? 'Best: ' + res.best + '%' : '') : 'Only a run from the first bar to the end is scored.' }))),
      h('div', { class: 'res-stats' },
        stat('check', 'Hit', res.stats.hit, 'is-hit'), stat('minus', 'Missed', res.stats.missed, 'is-missed'), stat('x', 'Wrong', res.stats.wrong, 'is-wrong')));
    const bars = res.bars || [];
    if (bars.length) {
      const strip = h('div', { class: 'res-bars', role: 'list', 'aria-label': 'Accuracy bar by bar' });
      bars.forEach((b, i) => {
        const a = barAcc(b);
        const lvl = a == null ? 'none' : a >= 0.9 ? 'good' : a >= 0.65 ? 'fair' : 'weak';
        const word = { none: 'not played', good: 'good', fair: 'some mistakes', weak: 'many mistakes' }[lvl];
        strip.append(h('button', { class: 'res-bar is-' + lvl, type: 'button', role: 'listitem', 'aria-label': 'Bar ' + (i + 1) + ': ' + (a == null ? word : pct(a) + ', ' + word) + '. Loop this bar.', title: 'Loop bar ' + (i + 1),
          onclick: () => { UI.closeDialog(); E.setOptions({ loop: { from: i + 1, to: i + 1 } }); } },
          h('span', { class: 'res-bar-num', text: String(i + 1) }), h('span', { class: 'res-bar-pct ds-tabular', text: a == null ? '–' : String(Math.round(a * 100)) })));
      });
      body.append(h('div', { class: 'ds-label', text: 'Bar by bar' }), strip,
        h('div', { class: 'res-legend ds-caption' }, h('span', { class: 'res-key is-good' }), 'Good', h('span', { class: 'res-key is-fair' }), 'Some mistakes', h('span', { class: 'res-key is-weak' }), 'Many mistakes'));
    }
    const weak = R.weakRange(bars);
    const buttons = [{ label: 'Close' }, { label: 'Play again', run: () => { E.stop(); E.play(); } }];
    if (weak) buttons.push({ label: 'Practise weak bars', primary: true, run: () => { E.setOptions({ loop: weak }); UI.toast(weak.from === weak.to ? 'Looping bar ' + weak.from + '.' : 'Looping bars ' + weak.from + ' to ' + weak.to + '.'); } });
    else buttons[1].primary = true;
    UI.openDialog('Results', body, buttons, { onClose: () => { R.open = false; E.resultsOpen = false; }, focus: '.dialog-actions .ds-btn--primary' });
    R.open = true; E.resultsOpen = true;
  };
  R.close = function () { if (R.open) UI.closeDialog(); R.open = false; E.resultsOpen = false; };

  E.on('finish', (res) => { if (res && res.kind === 'song' && E.runMode === 'practice') R.show(res); });
  E.on('result', (res) => {
    if (!res || res.kind !== 'loop' || res.accuracy == null) return;
    UI.toast('Loop pass: ' + pct(res.accuracy) + ' (' + res.stats.hit + ' hit, ' + res.stats.missed + ' missed, ' + res.stats.wrong + ' wrong).', null, { ms: 3500 });
  });

  // ---------------------------------------------------------------- first-run hint
  R.hint = function (root) {
    if (S.settings.hintDone) return;
    const done = () => { if (!card.isConnected) return; S.settings.hintDone = true; S.saveSettings(); card.remove(); };
    const main = h('span', { class: 'ds-control-text' }), sub = h('span', { class: 'ds-caption' });
    // the tip follows the mode: Freeplay has no play button and nothing to wait for
    const paint = () => {
      const free = W.free && W.free.active;
      main.textContent = free ? 'Play any key. Press R to record.' : 'Press Space or the play button. The notes wait for you.';
      sub.textContent = free ? 'Press F to go back to your song.' : 'Drop a scan, PDF, MusicXML or MIDI file anywhere to add a song.';
    };
    const card = h('div', { class: 'hint ds-popover', role: 'note' }, h('div', { class: 'hint-text' }, main, sub),
      h('button', { class: 'ds-btn ds-btn--ghost ds-btn--icon', type: 'button', 'aria-label': 'Dismiss the tip', onclick: done }, UI.icon('close')));
    paint();
    root.appendChild(card);
    if (W.free) W.free.onChange(paint);
    // gone for good once the player starts: Play in a song, or the first note in Freeplay
    E.on('change', () => { if (E.playing) done(); });
    E.on('key', (e) => { if (e && e.down && W.free && W.free.active) done(); });
  };
})();
