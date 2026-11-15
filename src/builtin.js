/* The six built-in pieces from version 1.0, converted to the version 2 song model.
 * They are short excerpts typed in by hand, not full editions: the library labels them "Built-in excerpt". */
(function () {
  'use strict';
  const W = window.Wapiro, U = W.util, N = W.notation;

  const LETTER_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const nameToMidi = (s) => { const m = /^([A-G])(#?)(\d)$/.exec(s); return (parseInt(m[3], 10) + 1) * 12 + LETTER_SEMI[m[1]] + (m[2] ? 1 : 0); };

  // [start in quarter notes, length in quarter notes, pitch name, hand]
// 1. Ode to Joy - L. van Beethoven (8 bars, 4/4)
const odeTuples = [
  // Bar 1
  [0,1,'E4','R'], [1,1,'E4','R'], [2,1,'F4','R'], [3,1,'G4','R'],
  [0,4,'C3','L'], [0,4,'G3','L'],
  // Bar 2
  [4,1,'G4','R'], [5,1,'F4','R'], [6,1,'E4','R'], [7,1,'D4','R'],
  [4,4,'G2','L'], [4,4,'G3','L'],
  // Bar 3
  [8,1,'C4','R'], [9,1,'C4','R'], [10,1,'D4','R'], [11,1,'E4','R'],
  [8,4,'A2','L'], [8,4,'E3','L'],
  // Bar 4
  [12,1.5,'E4','R'], [13.5,0.5,'D4','R'], [14,2,'D4','R'],
  [12,4,'G2','L'], [12,4,'D3','L'],
  // Bar 5
  [16,1,'E4','R'], [17,1,'E4','R'], [18,1,'F4','R'], [19,1,'G4','R'],
  [16,4,'C3','L'], [16,4,'G3','L'],
  // Bar 6
  [20,1,'G4','R'], [21,1,'F4','R'], [22,1,'E4','R'], [23,1,'D4','R'],
  [20,4,'G2','L'], [20,4,'G3','L'],
  // Bar 7
  [24,1,'C4','R'], [25,1,'C4','R'], [26,1,'D4','R'], [27,1,'E4','R'],
  [24,2,'F2','L'], [24,2,'C3','L'], [26,2,'G2','L'], [26,2,'D3','L'],
  // Bar 8
  [28,1.5,'D4','R'], [29.5,0.5,'C4','R'], [30,2,'C4','R'],
  [28,4,'C3','L'], [28,4,'E3','L'],
];

// 2. Minuet in G Major (BWV Anh. 114) - Petzold / J.S. Bach (3/4 time)
const minuetTuples = [
  // Bar 1 (3/4 -> 3 beats per bar)
  [0,1,'D5','R'], [1,0.5,'G4','R'], [1.5,0.5,'A4','R'], [2,0.5,'B4','R'], [2.5,0.5,'C5','R'],
  [0,2,'G3','L'], [0,2,'B3','L'], [2,1,'A3','L'],
  // Bar 2
  [3,1,'D5','R'], [4,1,'G4','R'], [5,1,'G4','R'],
  [3,3,'B3','L'],
  // Bar 3
  [6,1,'E5','R'], [7,0.5,'C5','R'], [7.5,0.5,'D5','R'], [8,0.5,'E5','R'], [8.5,0.5,'F#5','R'],
  [6,3,'C4','L'],
  // Bar 4
  [9,1,'G5','R'], [10,1,'G4','R'], [11,1,'G4','R'],
  [9,2,'B3','L'], [11,1,'G3','L'],
  // Bar 5
  [12,1,'C5','R'], [13,0.5,'D5','R'], [13.5,0.5,'C5','R'], [14,0.5,'B4','R'], [14.5,0.5,'A4','R'],
  [12,3,'A3','L'],
  // Bar 6
  [15,1,'B4','R'], [16,0.5,'C5','R'], [16.5,0.5,'B4','R'], [17,0.5,'A4','R'], [17.5,0.5,'G4','R'],
  [15,3,'G3','L'],
  // Bar 7
  [18,1,'F#4','R'], [19,0.5,'G4','R'], [19.5,0.5,'A4','R'], [20,0.5,'B4','R'], [20.5,0.5,'G4','R'],
  [18,2,'D3','L'], [20,1,'B2','L'],
  // Bar 8
  [21,3,'A4','R'],
  [21,1,'D3','L'], [22,1,'C3','L'], [23,1,'B2','L'],
];

// 3. Prelude in C Major (BWV 846) - J.S. Bach (4/4 broken chord pattern)
const preludeCTuples = [];
const bachMeasureChords = [
  ['C3', 'E3', 'G4', 'C5', 'E5'], // Bar 1: C Maj
  ['C3', 'D3', 'A4', 'D5', 'F5'], // Bar 2: Dm7/C
  ['B2', 'D3', 'G4', 'D5', 'F5'], // Bar 3: G7/B
  ['C3', 'E3', 'G4', 'C5', 'E5'], // Bar 4: C Maj
  ['C3', 'E3', 'A4', 'E5', 'A5'], // Bar 5: Am/C
  ['C3', 'D3', 'F#4', 'A4', 'D5'],// Bar 6: D7/C
  ['B2', 'D3', 'G4', 'D5', 'G5'], // Bar 7: G/B
  ['B2', 'C3', 'E4', 'G4', 'C5'], // Bar 8: Cmaj7/B
];
bachMeasureChords.forEach((ch, mIdx) => {
  const base = mIdx * 4;
  for (let half = 0; half < 2; half++) {
const offset = base + half * 2;
preludeCTuples.push([offset, 2, ch[0], 'L']);
preludeCTuples.push([offset + 0.25, 1.75, ch[1], 'L']);
preludeCTuples.push([offset + 0.5, 0.25, ch[2], 'R']);
preludeCTuples.push([offset + 0.75, 0.25, ch[3], 'R']);
preludeCTuples.push([offset + 1.0, 0.25, ch[4], 'R']);
preludeCTuples.push([offset + 1.25, 0.25, ch[2], 'R']);
preludeCTuples.push([offset + 1.5, 0.25, ch[3], 'R']);
preludeCTuples.push([offset + 1.75, 0.25, ch[4], 'R']);
  }
});

// 4. Gymnopédie No. 1 - Erik Satie (3/4 Time)
const gymnoTuples = [
  // Bar 1-4 Intro & Floating Melody
  [0,3,'G2','L'], [1,2,'B3','L'], [1,2,'D4','L'], [1,2,'F#4','L'],
  [3,3,'D2','L'], [4,2,'A3','L'], [4,2,'C#4','L'], [4,2,'F#4','L'],
  [6,3,'G2','L'], [7,2,'B3','L'], [7,2,'D4','L'], [7,2,'F#4','L'], [7,1,'F#5','R'], [8,1,'A5','R'],
  [9,3,'D2','L'], [10,2,'A3','L'], [10,2,'C#4','L'], [10,2,'F#4','L'], [9,1,'G5','R'], [10,1,'F#5','R'], [11,1,'C#5','R'],
  [12,3,'G2','L'], [13,2,'B3','L'], [13,2,'D4','L'], [13,2,'F#4','L'], [12,1,'B4','R'], [13,1,'C#5','R'], [14,1,'D5','R'],
  [15,3,'D2','L'], [16,2,'A3','L'], [16,2,'C#4','L'], [16,2,'F#4','L'], [15,3,'A4','R'],
  [18,3,'F#2','L'], [19,2,'A3','L'], [19,2,'C#4','L'], [19,2,'F#4','L'], [18,3,'F#4','R'],
  [21,3,'B2','L'], [22,2,'B3','L'], [22,2,'D4','L'], [22,2,'G4','L'], [21,3,'D5','R']
];

// 5. Prelude in E Minor (Op. 28 No. 4) - F. Chopin (4/4 Time)
const chopinTuples = [
  // Bar 1
  [0,3,'B4','R'], [3,1,'C5','R'],
  [0,1,'G3','L'], [0,1,'B3','L'], [0,1,'E4','L'],
  [1,1,'G3','L'], [1,1,'B3','L'], [1,1,'E4','L'],
  [2,1,'G3','L'], [2,1,'B3','L'], [2,1,'E4','L'],
  [3,1,'G3','L'], [3,1,'B3','L'], [3,1,'E4','L'],
  // Bar 2
  [4,4,'B4','R'],
  [4,1,'F#3','L'], [4,1,'A3','L'], [4,1,'D#4','L'],
  [5,1,'F#3','L'], [5,1,'A3','L'], [5,1,'D#4','L'],
  [6,1,'F#3','L'], [6,1,'A3','L'], [6,1,'D#4','L'],
  [7,1,'F#3','L'], [7,1,'A3','L'], [7,1,'D#4','L'],
  // Bar 3
  [8,3,'B4','R'], [11,1,'C5','R'],
  [8,1,'F3','L'], [8,1,'A3','L'], [8,1,'D4','L'],
  [9,1,'F3','L'], [9,1,'A3','L'], [9,1,'D4','L'],
  [10,1,'E3','L'], [10,1,'G#3','L'], [10,1,'D4','L'],
  [11,1,'E3','L'], [11,1,'G#3','L'], [11,1,'D4','L'],
  // Bar 4
  [12,4,'A4','R'],
  [12,1,'E3','L'], [12,1,'A3','L'], [12,1,'C4','L'],
  [13,1,'E3','L'], [13,1,'A3','L'], [13,1,'C4','L'],
  [14,1,'E3','L'], [14,1,'F#3','L'], [14,1,'C4','L'],
  [15,1,'E3','L'], [15,1,'F#3','L'], [15,1,'C4','L'],
];

// 6. Twinkle, Twinkle, Little Star (Ah! vous dirai-je, maman) - W.A. Mozart (4/4 Time)
const mozartTuples = [
  [0,1,'C4','R'], [1,1,'C4','R'], [2,1,'G4','R'], [3,1,'G4','R'],
  [0,2,'C3','L'], [2,2,'E3','L'],
  [4,1,'A4','R'], [5,1,'A4','R'], [6,2,'G4','R'],
  [4,2,'F3','L'], [6,2,'E3','L'],
  [8,1,'F4','R'], [9,1,'F4','R'], [10,1,'E4','R'], [11,1,'E4','R'],
  [8,2,'D3','L'], [10,2,'C3','L'],
  [12,1,'D4','R'], [13,1,'D4','R'], [14,2,'C4','R'],
  [12,2,'G2','L'], [14,2,'C3','L'],
  [16,1,'G4','R'], [17,1,'G4','R'], [18,1,'F4','R'], [19,1,'F4','R'],
  [16,2,'E3','L'], [18,2,'D3','L'],
  [20,1,'E4','R'], [21,1,'E4','R'], [22,2,'D4','R'],
  [20,2,'C3','L'], [22,2,'G2','L'],
];

  const PIECES = [
    { id: 'builtin-ode-to-joy', title: 'Ode to Joy (excerpt)', composer: 'Ludwig van Beethoven', tuples: odeTuples, bpm: 108, num: 4, den: 4, fifths: 0 },
    { id: 'builtin-minuet-in-g', title: 'Minuet in G major (excerpt)', composer: 'Christian Petzold', tuples: minuetTuples, bpm: 112, num: 3, den: 4, fifths: 1 },
    { id: 'builtin-prelude-in-c', title: 'Prelude in C major, BWV 846 (excerpt)', composer: 'Johann Sebastian Bach', tuples: preludeCTuples, bpm: 78, num: 4, den: 4, fifths: 0 },
    { id: 'builtin-gymnopedie-1', title: 'Gymnopédie No. 1 (excerpt)', composer: 'Erik Satie', tuples: gymnoTuples, bpm: 76, num: 3, den: 4, fifths: 2 },
    { id: 'builtin-prelude-in-e-minor', title: 'Prelude in E minor, Op. 28 No. 4 (excerpt)', composer: 'Frédéric Chopin', tuples: chopinTuples, bpm: 66, num: 4, den: 4, fifths: 1 },
    { id: 'builtin-twinkle', title: 'Ah! vous dirai-je, maman (excerpt)', composer: 'Wolfgang Amadeus Mozart', tuples: mozartTuples, bpm: 104, num: 4, den: 4, fifths: 0 },
  ];

  function build(p) {
    const notes = p.tuples.map((t) => {
      const midi = nameToMidi(t[2]);
      const sp = U.spellInKey(midi, p.fifths);
      return { q: Number(t[0]), durQ: Number(t[1]), midi, hand: t[3] || 'R', spelled: U.spell(sp.letter, sp.alter, sp.oct) };
    });
    U.sortNotes(notes);
    const end = Math.max(...notes.map((n) => n.q + n.durQ));
    const measures = W.midi.buildMeasures([{ q: 0, num: p.num, den: p.den }], end);
    const song = {
      id: p.id, title: p.title, composer: p.composer, source: 'builtin', exactNotation: false, handsGuessed: false, handsFrom: 'tracks',
      tempos: [{ q: 0, bpm: p.bpm }], timeSigs: [{ q: 0, num: p.num, den: p.den }], keySigs: [{ q: 0, fifths: p.fifths }],
      measures, notes, notation: null, warnings: [],
    };
    song.notation = N.fromNotes(song);
    return song;
  }

  W.builtin = { list: () => PIECES.map(build), ids: PIECES.map((p) => p.id) };
})();
