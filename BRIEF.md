# Build brief: MarkSteady Wapiro v2.0

You are building version 2.0 of a piano practice web app. Version 1.0 is one HTML file
(`assets/v1_0_0.html`, 3,363 lines). A code review found that its headline feature was faked, its
sheet view was not real notation, its screen was cluttered and several bugs corrupted results.
Version 2.0 fixes that. Read this whole brief before writing code.

The owner will open the result on a Windows PC and on an Android tablet (landscape, on a music
stand), with a MIDI keyboard connected by USB. A reviewer will run the tests in `tests/` and look
at screenshots. Nothing in the UI may claim a capability the code does not have.

## 1. Deliverable and hard constraints

- **One file:** `dist/marksteady_waterfall_piano_roll_v2_0_0.html`. It must work by double-click
  (`file://`), fully offline. **No network requests at all**: no CDN, no web fonts, no icon fonts,
  no analytics. The acceptance test blocks the network and fails on any request.
- **No installs.** This sandbox has no network. Use only what is here: Node 22, Python 3
  (fontTools, lxml, Pillow, numpy), Playwright at `/opt/npm-tools/node_modules/playwright` with
  Chrome at `/usr/bin/google-chrome` (launch with `--no-sandbox`). Do not run npm/pip install and
  do not try to download anything.
- **Plain JavaScript (ES2020), plain CSS, no framework.** Write source as separate files under
  `src/` and assemble them with a small `build.py` (concatenate CSS and JS into
  `src/index.template.html`, in an explicit order). Escape `</script>` inside inlined code. Each JS
  file is an IIFE that attaches to one `Wapiro` namespace. Keep files under about 800 lines each.
- **Storage:** songs in IndexedDB, settings in localStorage. Never swallow a storage error: tell
  the user.
- **Never build HTML from user data with innerHTML.** Titles and file names go in with textContent.
- **Viewport:** no `user-scalable=no`, no `maximum-scale`. No global `user-select: none`.
- Provided for you (do not edit): `assets/suite-core.css`, `assets/glyphs.js`,
  `fixtures/*`, `tests/make_fixtures.py`, `tests/run_acceptance.js`, `tests/run_behaviour.js`.

## 2. Decisions already made by the owner

1. **Import:** MusicXML (`.musicxml`, `.xml`) and compressed MusicXML (`.mxl`) for exact notation,
   plus a correct MIDI import. **No PDF recognition.** A PDF gets an honest helper card (section 8).
2. **Devices:** Windows PC with mouse and keyboard, and an Android tablet in landscape with touch.
   Both with a MIDI keyboard. No phone layout. **No microphone input** (remove it).
3. **Main screen:** one view at a time (Waterfall or Sheet), plus an optional Split view with a
   drag handle between the two panes. Waterfall is the default.
4. **Design system:** Suite Core only (section 7). Appearance switch: Auto, Light, Dark, Light
   increased contrast, Dark increased contrast.
5. English interface. Version string `2.0.0`. Product name "MarkSteady Wapiro"; document title
   "MarkSteady Waterfall Piano Roll (MarkSteady Wapiro) v2.0.0".

Out of scope for 2.0 (do not build, do not hint at in the UI): sampled piano sound, timing-based
scoring, fingering, progress history charts, score editing on the staff, PDF recognition.

## 3. Data model

All musical time is in **quarter notes from the start of the piece** (`q`), as floating point.
Never store a fixed "beats per bar": bars come from the `measures` list.

```js
Song = {
  id, title, composer,
  source: 'musicxml' | 'midi' | 'builtin',
  exactNotation: boolean,     // true only for unedited MusicXML
  handsGuessed: boolean,      // true when the file did not say which hand plays what
  tempos:   [{ q, bpm }],             // bpm = quarter notes per minute; at least one entry at q = 0
  timeSigs: [{ q, num, den }],        // at least one entry at q = 0
  keySigs:  [{ q, fifths }],          // -7..7; may be empty for MIDI without a key
  measures: [{ q, lenQ }],            // in PLAYBACK order (repeats already unfolded), contiguous, covering every note
  notes:    [{ q, durQ, midi, hand: 'R' | 'L', spelled }], // sounding notes: ties merged, sorted by q then midi
  notation: {...},            // what the Sheet view draws (your design; see section 6)
  warnings: [string],         // plain sentences shown in the import review
}
```

- `spelled` is the note name as written: letter, accidental (`#`, `b`, `x`, `bb` or none), octave.
  Examples: `Bb4`, `F#5`, `E5`. Middle C is `C4` = MIDI 60. Accept and keep MIDI 21 to 108 (88
  keys). Notes outside 21..108 are dropped with a warning that says how many.
- `measures` for MIDI: built from the time signatures; a bar lasts `num * 4 / den` quarter notes;
  the last bar is the one that contains the end of the last note.

## 4. Import and export core (milestone 1)

Expose exactly this on `window` as soon as the page has loaded:

```js
window.WapiroCore = {
  importFile(fileName, arrayBuffer) -> Promise<Song>,  // rejects with Error(message) the user can read
  exportMidi(song) -> Uint8Array,                      // Standard MIDI File
};
```

`importFile` picks the parser from the content first (ZIP signature, `MThd`, XML root element),
then from the extension. It never falls back to another song (v1 loaded "Ode to Joy" when a MIDI
file had no notes). A file with no playable notes, or an XML file that is not `score-partwise` /
`score-timewise`, is rejected with a clear message. A PDF (`%PDF`) is rejected with a message that
names MusicXML as the route.

**MusicXML (`score-partwise`; convert `score-timewise` if cheap, otherwise reject clearly)**
- Read with `DOMParser`. Handle `divisions` changes, `backup`/`forward`, `chord`, `voice`, `staff`,
  `rest`, dots, `time-modification` (tuplets), `tie` (merge tied notes into one sounding note),
  grace notes (skip for playback; add a warning), `key`, `time`, `clef`, `sound tempo` and
  `metronome`, pickup bars (`implicit="yes"`: the bar is as long as its content), `transpose`
  ignored for piano.
- **Hands:** one part with two staves: staff 1 = right, staff 2 = left. Two single-staff parts:
  first = right, second = left. One single-staff part: guess (see MIDI) and set `handsGuessed`.
  More parts: take the first piano-like part (two staves), warn about the rest.
- **Repeats:** unfold forward/backward repeats and first/second endings into playback order. For
  D.C./D.S./Coda: do not unfold; add a warning.
- **Title/composer:** `work-title` or `movement-title`, `creator type="composer"`; else file name.
- **MXL:** a ZIP. Read the central directory yourself, find the root file via
  `META-INF/container.xml` (else the first `.musicxml`/`.xml` not in `META-INF`), inflate with
  `DecompressionStream('deflate-raw')`. Support stored and deflated entries.
- Keep what the Sheet view needs from the file as written: note types, dots, stems, beams,
  accidentals, voices, ties, tuplets, rests, clefs, key and time changes, barlines, endings.

**MIDI in**
- Formats 0 and 1, running status, note-on with velocity 0 as note-off, all meta events, sysex.
  SMPTE division: reject with a clear message.
- Full tempo map (every tempo event), every time signature **with its denominator** (v1 read
  only the numerator), key signature meta if present.
- **Keep note timing exact** in `notes` (tick precision). Quantise only for notation.
- Ignore channel 10 (drums). Same-pitch overlaps: pair first-in first-out.
- **Hands:** exactly two tracks (or two channels) with notes: use track names if they say
  right/left/RH/LH/treble/bass/upper/lower, otherwise first = right, second = left. Otherwise
  guess: walk through time, keep a running centre for each hand, respect a hand span of about a
  ninth, start the split at middle C. Set `handsGuessed: true`.
- Spelling from the key signature (flats in flat keys). No key in the file: estimate it
  (Krumhansl-Schmuckler profile is fine) and do not add an entry to `keySigs`.

**MIDI out (`exportMidi`)**: format 1, 480 PPQ, track 0 = tempo map, time signatures, key
signatures; track 1 named "Right Hand", track 2 named "Left Hand", both channel 1. A pickup bar
may be written as a short bar. This is the app's MusicXML-to-MIDI function; the UI offers it as
"Export MIDI" per song.

**Notation from MIDI (approximate, always labelled so):** per beat choose the better of a
sixteenth grid and a triplet-eighth grid; one voice per hand; chords are notes with the same
onset; split durations at beats and barlines with ties; fill gaps with rests; beam by beat.
Right hand on the treble staff, left hand on the bass staff.

**Check:** `node tests/run_acceptance.js` must print "All acceptance checks passed". The fixtures
stand in for the tester's real files and cover: beams, dots, rests, chords, 16ths; flats and
explicit accidentals; left hand above middle C and right hand below it; 6/8 changing to 3/4; a
tie across a barline; triplets; a pickup bar; two voices on one staff; a repeat with first and
second endings; a tempo change; A0 and C8; seconds in chords; two-part scores; `.mxl`; MIDI with
two hand tracks; format 0 with running status; tempo changes; pedal; a drum track; an empty file.
Do not edit the fixtures or the test to make it pass.

## 5. Practice engine (milestone 2)

- **Clock:** position advances from `performance.now()` through the tempo map and the speed
  factor. It must advance even when the AudioContext is suspended or missing. Schedule app-made
  sound (other hand, listen mode, metronome) a little ahead on the audio clock.
- **Modes:** Practice (the user plays) or Listen (the app plays everything; never scored).
- **Wait for me** (default on): at every onset of the practised hand(s), the position holds
  exactly on that onset until each required pitch has had a note-on. Order within a chord is
  free. Wrong pitches count as wrong and do not advance. Notes pressed up to 150 ms early count.
- **In tempo** (wait off): a note is hit if played within +-max(100 ms, 0.12 beat); otherwise it
  becomes missed once the window has passed.
- **Seeking never snaps back.** Every seek (bar click, previous/next bar, loop wrap, restart,
  timeline drag) resets progress from the target: notes at or after it become pending, notes
  before it are simply out of this run. v1 dragged the player back to the first unplayed note.
- **Loop:** a bar range. Setting a loop while the position is outside it moves the position to
  the loop start; Play and Stop then start from the loop start. Wraps cleanly.
- **Hands:** Both, Right, Left. The app plays the other hand (own volume control).
- **Speed:** 25% to 150% in 5% steps; show the resulting BPM.
- **Metronome** with accent on the downbeat, following the time signature, and a one-bar
  **count-in** (default on for In tempo, off for Wait).
- **Restart bar after N mistakes:** Off by default (v1 defaulted to 3 and confused first use).
  When a bar restarts, that bar's counts roll back.
- **Scoring:** accuracy = hit / (hit + missed + wrong), over the notes of the practised hand(s).
  A best score is saved only for a Practice run that reached the end of the song (or completed
  the loop) from its start. Opening the results panel never saves anything. Listen mode never
  saves anything. v1 saved "100%, grade S" for doing nothing. No letter grades.
- **Input:** Web MIDI (all inputs, hot-plug, note on/off, sustain CC64), on-screen keys (mouse and
  multi-touch, glissando), and optional computer-keyboard notes (off by default; when on, letter
  shortcuts are disabled). Accept MIDI notes 21 to 108. If the browser has no Web MIDI, say so
  once in the devices popover: "This browser has no Web MIDI. Use Chrome or Edge."
- **Sound:** Web Audio synth (improve v1's piano tone modestly; keep piano, electric piano,
  organ). Master volume, mute, accompaniment volume, and "Play sound for my notes" (so owners of
  digital pianos can turn it off). Sustain pedal works for held notes.
- **Performance:** no full scans of the note list per frame; index by time. Redraw canvases only
  when something changed. Long songs (20,000 notes) must stay smooth.

## 6. Views (milestones 2 and 3)

**Keyboard (bottom):** all 88 keys available; by default zoomed to the song's range rounded out
to whole octaves, with a "Show all 88 keys" option. Keys light for the user's notes and show the
next expected keys. Octave labels on C only.

**Waterfall:** falling bars aligned to the keys, strike line at the keyboard's top edge, bar
lines with bar numbers, no particles, no glow, no gradients. **Nothing may overlay the strike
line.** About two bars of look-ahead by default (zoom control in the view).

**Colour and state (never colour alone):**
- Right-hand notes: fill `--primary` with a 1px `--input` border. Left-hand notes: a solid
  neutral (`--neutral-700` in light appearances, `--neutral-200` in dark ones).
- Hit: the bar turns hollow (outline only). Missed: outline in `--destructive` with a diagonal
  hatch. Waiting target: 2px ring in `--ring` on the bar and on the key.
- When one hand is practised, the other hand's notes are drawn at 45% opacity.

**Sheet (your own renderer, SVG):** real notation, drawn from `song.notation`.
- Layout: grand staff systems that wrap to the pane width and scroll vertically, a brace, clefs,
  key signature on every system, time signature at the start and at changes, bar numbers at
  system starts. Staff size adjustable (A-/A+). Default about four bars per system on a desktop.
- Staves at least 6 staff spaces apart. Staff lines, stems and barlines in `--foreground`.
  Sheet background `--card`.
- Horizontal spacing by duration (longer notes get more room, compressed, not linear), notes
  that sound together align across both staves, systems justified to full width.
- Notes: correct vertical position per clef, ledger lines, **stems by the standard rule**
  (use the file's stem direction when given; otherwise notes on or above the middle line stem
  down; a chord follows its note farthest from the middle line), one stem per chord, seconds in
  a chord offset to the other side of the stem, open heads for half and whole notes, dots,
  flags for unbeamed eighths and shorter.
- Beams as in the file (levels 1 to 3, partial beams), or by beat for MIDI. Rests. Ties.
  Tuplet numbers. Accidentals as written in the file (for MIDI: by key signature with normal
  bar-long accidental memory), never "every black key is a sharp".
- Two voices on a staff: voice 1 stems up, voice 2 stems down. Key signatures for all keys.
  Repeat barlines and ending brackets are drawn (playback is already unfolded: draw the
  written score once and map playback positions onto it).
- Glyphs: `assets/glyphs.js` has outlines for clefs, rests, noteheads, flags, accidentals and
  the brace (font units, 1000 per em, y up; a notehead is about 200 units = one staff space
  tall). Draw them as SVG paths. Calibrate their placement by looking at screenshots.
  Time-signature digits may be bold text in the system serif font.
- Not drawn in 2.0: slurs, dynamics, articulations, pedal marks, ottava, lyrics, grace notes.
- **Cursor:** a vertical line in `--primary-ink` across the grand staff at the current time,
  moving smoothly between note columns. The view scrolls by whole systems (like turning a
  page), not continuously. Missed notes get a small cross below them in `--destructive`; no
  other colouring.
- Click a bar to seek there. Approximate notation shows a neutral badge "Approximate notation
  (from MIDI)" in the sheet header.

**Split:** Sheet above, Waterfall below, a drag handle on the divider (visible on hover, always
visible on touch), position remembered.

## 7. Interface: Suite Core, quiet canvas, progressive chrome

Use `assets/suite-core.css` as is (tokens for four appearances plus `ds-` components). Rules
from the design system that you must follow:
- Every colour, radius, shadow and space is a token variable. **No literal hex** outside that
  file. Never pure white or pure black.
- Neutral first, **one accent**: `--primary` is for the one thing that matters on screen (the
  Play button, right-hand notes, the active tool). Accent text or thin lines use `--primary-ink`.
  Accent-filled controls carry a 1px `--input` border.
- Status colours (`--destructive`, `--success`, `--warning`) always come with an icon or a word.
  Badges are neutral or status, never accent.
- Type: `--font-sans` stack (system fonts; nothing is downloaded). Weights 400, 500, 600 only.
  **Never below 12px.** Sentence case everywhere. Buttons are verbs. Plain, calm, short. No
  exclamation marks, no emoji, no marketing words ("Zero Cloud", "Studio", "OMR" are gone).
- Focus: 2px `--ring` outline, offset 2px, on everything focusable.
- Motion: reveal 120 to 150 ms ease-out, hide 100 ms; under reduced motion crossfade only.
- Controls are 32px tall for mouse; **at least 44px on touch** (`@media (pointer: coarse)`).
- Icons: inline SVG, mono, 1.5px stroke, drawn by you. No icon font.

**The owner's standing design rules:** reduce visual noise; reveal controls on hover; use drag
and drop with handles on anything movable; make the workflow logical.

**Layout**
- **Top bar (44px, `--card`):** left: the song title as a button that opens the Library, with a
  neutral source badge. Centre: Restart, Previous bar, **Play/Pause (the only accent-filled
  control)**, Next bar, and "Bar 5 of 32". Right: a segmented switch Waterfall / Sheet / Split,
  then three icon buttons with tooltips: Practice options, Sound and devices, More.
- **Timeline strip (about 28px):** bar ticks, progress, click or drag to seek, and the loop
  range as a band with **two drag handles** (shown on hover, always shown on touch).
  Double-click the band to clear the loop. This replaces v1's A/B number boxes.
- **Stage:** the music view fills the rest. **Keyboard** at the bottom.
- **While playing**, everything except Play/Pause, the bar counter and the music fades out after
  2.5 s without pointer movement and returns on pointer move, key focus or pause. On touch, a
  tap on the stage toggles it. No live hit/miss counters during play: results come after.
- **Practice options popover:** Mode (Practice / Listen), Wait for me, Hands, Speed, Loop (on/off
  and "Bars 5 to 8", Clear), Metronome, Count-in, Restart bar after mistakes.
- **Sound and devices popover:** volume, accompaniment volume, sound for my notes, instrument,
  MIDI devices and their state, computer-keyboard notes.
- **More menu:** Import, Library, Correct notes, Export MIDI, Appearance, Keyboard shortcuts,
  Back up library, Restore backup, About.
- **Results panel** after a Practice run: accuracy, hit / missed / wrong (word plus icon), a
  bar-by-bar strip (pattern plus number, click a bar to loop it), buttons "Practise weak bars"
  (primary), "Play again", "Close". If the run was partial: "Not enough played to score."
- **First run:** the app opens paused on a built-in piece with one small dismissible hint:
  "Press Space or the play button. The notes wait for you." First-run default is Hands = Right
  so the first thing asked is a single note, and the hint says so.
- **Shortcuts** (when computer-keyboard notes are off): Space play/pause (v1 used Space for
  the pedal; move the pedal to Shift), Home restart, Left/Right previous/next bar, L loop,
  W wait, H cycle hands, V next view, M metronome, +/- speed, ? shortcut list, Esc close.
  Ctrl+Z / Ctrl+Y undo/redo in Correct notes. After using a select or popover, shortcuts and
  note keys must work again without an extra click (v1 kept focus in the dropdown).
- **Accessibility floor:** WCAG 2.2 AA. Real buttons with labels, `aria-pressed` on toggles,
  dialogs trap focus and close on Esc, text at least 4.5:1, graphics at least 3:1.

## 8. Library, import review, corrections (milestone 4)

- **Library panel:** search, rows with title, composer, source badge, best score, bar count. Row
  actions appear on hover (always on touch): Rename, Export MIDI, Delete. Rows reorder by a
  **drag handle**. Delete shows an Undo toast for 5 s instead of a confirm dialog. An Import
  button, and files can be dropped anywhere on the window.
- **Import review** (after choosing or dropping a file, before anything is saved): editable
  title, key, time signature, tempo, bars, note count, where the hands came from ("from the
  staves", "from the tracks", "guessed: please check"), the warnings, and a preview of the first
  system. When hands were guessed: "Swap hands" and a split-point control. Buttons: "Add to
  library" (primary), "Cancel".
- **PDF:** no fake scanning. Show a card: "A PDF is a picture of the music, so the app cannot
  read the notes from it. Convert it to MusicXML first, then import that file here." with two
  links that open in a new tab: Audiveris (free program for Windows, works offline,
  https://github.com/Audiveris/audiveris) and ACE Studio's online converter (free tier; the PDF
  is uploaded to that company, https://acestudio.ai/pdf-to-musicxml/). Add: "Any tool that
  exports MusicXML works."
- **Built-in pieces:** carry over v1's six pieces from `assets/v1_0_0.html`, converted to the new
  model, labelled honestly: source "Built-in excerpt", with their real bar counts (4 to 8 bars).
  Remove the "Mutopia / OpenScore" claims.
- **Correct notes** (editing happens in the waterfall, paused): tap an empty lane to add a note
  (grid: quarter, eighth, sixteenth, triplet), drag a note to move it, drag its top-edge handle
  to change its length, Delete removes the selection, R/L sets the hand. Undo/redo, at least 100
  steps. **Autosave within 500 ms; there is no Save button.** Editing a MusicXML song makes its
  notation approximate (tell the user once, offer "Revert to imported").
- **Settings persist:** appearance, view, split position, volumes, practice options, and per song
  the speed, hands and loop.
- **v1 library:** if `localStorage['marksteady_wapiro_v1_library']` exists, convert the user's own
  songs once (v1 `beat` = `q`), skip v1's six starter songs, leave the old key untouched.
- **Backup:** export everything as versioned JSON. Restore validates the file, then says what it
  will do ("Adds 4 songs, replaces 2. Your other 6 songs stay.") and merges. It never silently
  replaces the library.

## 9. Test hooks

Expose `window.WapiroTest`. Every function must call the same code path the UI uses (no shortcuts
that bypass the engine). Functions may return promises.

```
reset()                      clear all stored data and return to first-run state (no page reload)
listSongs()                  [{ id, title, source, best }]        best: number 0..100 or null
songInfo(id)                 { id, title, notes, measures, exactNotation, handsGuessed }
importBytes(name, buffer)    same path as the UI import, review step auto-confirmed
                             -> { ok: true, id } or { ok: false, error }
openSong(id)
setOptions({ wait, hands, speed, loop, restartAfter, metronome, countIn })
                             hands 'both'|'R'|'L'; speed 0.25..1.5; loop null or { from, to } (bars, 1-based)
seekMeasure(n)               1-based, in playback order
play()  pause()  stop()      stop returns to the start (or the loop start)
listen()                     start Listen mode from the current position
noteOn(midi, velocity)  noteOff(midi)      same path as a MIDI keyboard
state()                      { songId, playing, mode: 'practice'|'listen', q, measure,
                               waitingFor: [{ q, midi, hand }], stats: { hit, missed, wrong },
                               view: 'waterfall'|'sheet'|'split',
                               appearance: 'auto'|'light'|'dark'|'light-hc'|'dark-hc', activeKeys: [midi] }
openResults()  closeResults()              closeResults is a no-op when nothing is open
editAddNote({ q, durQ, midi, hand })  undo()  redo()
deleteSong(id)  setView(view)  setAppearance(appearance)
```

`node tests/run_behaviour.js` must print "All behaviour checks passed".

## 10. v1 defects that must not come back

1. Fake PDF recognition and its false "complete" message.
2. Notes outside C2..C7 clamped to C2/C7; MIDI snapped to sixteenths; time-signature denominator
   ignored; only the last tempo used; empty file replaced by another song.
3. A "staff" without key signatures, rests, beams, dots or ties; wrong stems; hands placed by
   pitch; staves two spaces apart; 1.8:1 staff lines; hit and pending looking the same.
4. 25 controls and 7 live counters always visible, 9 to 11px text, five accent colours, badges
   over the staff, buttons on the strike line, pinch-zoom disabled.
5. Best score saved without playing; seeking and looping broken in wait mode; edits lost
   without Save; no undo; no delete; backup restore overwriting everything; storage errors
   swallowed; titles inserted as HTML; three CDNs under a "Zero Cloud" badge.
6. Microphone input (removed). Particles, glows, gradients, pulsing animations (removed).

## 11. How to work

Milestones, in order: (1) core + acceptance test green; (2) shell, engine, waterfall, keyboard,
sound, input, top bar, timeline, options; (3) sheet renderer, cursor, split; (4) library, import
review, results, corrections, persistence, backup, appearance, shortcuts, first run; (5) review.

- Rebuild and run the tests after each milestone.
- **Look at your work.** Write `tests/shots.js` (Playwright) that saves PNG screenshots to
  `shots/` at 1440x900 and 1280x800: waterfall, sheet (fixtures x1, x3, x4 and a MIDI import),
  split, each popover, library, import review, results; light and dark. Open the PNGs with the
  Read tool and fix what looks wrong. The sheet must look like engraved music: check clef
  placement, stems, beams, accidentals and spacing with your own eyes.
- Keep `NOTES.md` current: what is done, what is not, every deviation from this brief and why,
  and known limits. Be exact and honest there; the reviewer checks claims against the code.
- No stubs, no "coming soon", no dead buttons. If something cannot be finished, leave it out of
  the UI and write it in `NOTES.md`.
