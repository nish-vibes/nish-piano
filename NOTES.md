# MarkSteady Wapiro 2.0.0 prototype: build notes

## Status
All three test suites pass on dist/marksteady_waterfall_piano_roll_v2_0_0.html (about 2 MB, one file, offline):
- `node tests/run_acceptance.js`: MusicXML, MXL and MIDI import, MIDI export round trip, no network, no page errors.
- `node tests/run_behaviour.js`: wait/in-tempo/listen modes, seeking and loops, 88 keys, scoring rules, edit + undo, persistence, delete.
- `node tests/run_pdf.js`: PDF reader on four vector test PDFs (every note, length, bar, key, time signature correct) and refusal of a broken PDF.

## PDF to MusicXML (src/core-pdf.js)
- Reads the vector drawing of PDFs exported from notation software whose music font follows SMuFL (MuseScore, Dorico, Finale 27+).
  Uses pdf.js 6.2.108 (Apache-2.0), bundled inside the file and run on the main thread, loaded only when a PDF is opened.
- Finds staves, grand-staff pairs, barlines, stems, beams, flags, dots, ties, tuplet numbers, accidentals, key and time
  signatures, clefs and clef changes, rests, two voices per staff, pickup bars, repeats and 1st/2nd endings, title, composer, tempo mark.
- Writes MusicXML, which goes through the normal MusicXML import. The review step offers "Download MusicXML".
- Not read: slurs, dynamics, grace notes, ornaments, lyrics, cross-staff beams, D.C./D.S., 8va lines, unbeamed tuplets with brackets only.
- Scans and photos are refused with a message pointing to Audiveris; PDFs with non-SMuFL music fonts (older Sibelius Opus,
  Finale Maestro, LilyPond Emmentaler) are refused with a message too.
- LIMIT: tested only on PDFs printed from this app's own renderer with an SMuFL test font (tests/make_pdf.js,
  tests/make_smufl_font.py). Not yet tested on a real MuseScore/Dorico/Finale PDF; expect fixes once real files are tried.

## Milestone 4 (done in this session)
Library (search, rename, export MIDI, delete with undo, drag-handle reorder with arrow-key alternative, import, drop anywhere),
import review (title, composer, key/time for MIDI, tempo, hands source, swap hands and split point when guessed, warnings, first-system preview),
PDF help card, results panel (accuracy, hit/missed/wrong with icons, bar strip with pattern + number, practise weak bars, play again),
loop-pass toast, Correct notes editor in the waterfall (add, move, resize by top edge, delete, hand, grid, keyboard alternatives, undo/redo 100, autosave, Revert to imported),
backup and restore with validation and merge summary, version 1 library conversion, first-run hint, extended shortcut list.

## Changes from the brief
- Best score: saved only for a Practice run of the whole song from bar 1 with no loop. A loop pass shows a toast, never sets the best.
- Notation from MIDI and built-in pieces now uses up to two voices per hand.
- Sheet visuals were reviewed only roughly; the owner will judge them.

## Waterfall look and effects (`src/waterfall.js`)
- Note bars are drawn as coloured glass (clear body, lit edge, gloss, rim). Dark appearance adds a nebula and a slow star field behind them; high-contrast appearances keep plain solid bars and no backdrop.
- The engine emits `hit`, `wrong` and `miss`. The waterfall answers with a burst and star dust (hit), a red beam up the lane of the wrong key (wrong) and a short shake (miss).
- In-tempo mode (Wait for me off): a note may be played late until 30 % of its length has passed, never less than the old timing window. After that it is missed. Wait for me on: notes cannot be missed.
- Every colour is derived from the tokens (no literal colours). The beam on dark uses the hue of `--destructive` at full saturation, because the dark token is a soft salmon made for text.
- `prefers-reduced-motion`: no particles, shake, star drift or sweep; hit and wrong fade in place.
- More than three wrong keys a second: later beams rise slowly and stay dim, so a run of wrong keys never strobes (WCAG 2.3.1).
- Effects keep the canvas drawing only until they end (`WF.fxAlive()`); nothing is queued in Sheet view.

## Freeplay, Record and Export video (`src/freeplay.js`)
- Playing a key outside a scored run emits `free`; the waterfall shows a ray in the hand's colour (left below middle C = c1 = MIDI 60).
- Freeplay (header button, F): waterfall alone via `S.viewOverride` (the saved view is untouched), the song is hidden and cannot play, notes leave rising glass bars. Leaving restores the song and view.
- Record (header button): enters Freeplay, keeps key presses, and on stop saves a song (120 bpm, 1/32 grid, starts at the first note, `source: 'recording'`) and opens it. The sustain pedal is not recorded.
- Export video (More menu): plays the song once in listen mode and records a composite canvas (waterfall + painted keys + title) with the app's sound through `MediaRecorder`. Real time, at the current speed. MP4 (H.264 with AAC, else Opus) when the browser can, else WebM. The window must stay visible.

## Known limits
- Real MIDI keyboard, audio and touch not tested on hardware.
- Results bar strip uses hatched patterns plus numbers; colours are tokens with transparency.

## Scans and photos (v2.0, `src/scan.js`)

Most users bring a low-resolution scan, not a notation-software PDF. Flow:

1. **Any image or image-only PDF** goes to the scan flow: drop, file picker (PNG/JPG/WebP/BMP/GIF/PDF), or paste a copied image (Ctrl+V). A PDF whose pages have no vector staves is routed here from the PDF reader (`err.code === 'NO_VECTOR'`).
2. **Prepare** each page: render at the embedded image's own resolution, measure the staff-line spacing from vertical run lengths (white+black "combo" histogram, as Audiveris does), enlarge in ≤2× steps to about 20 px between lines (Audiveris's sweet spot), contrast-stretch, sharpen, gentle S-curve. Cap 6000 px.
3. **Check**: each page with a verdict in words and an icon — Good (≥14 px), Fair (8–13), Low resolution (<8), No staff found — and what was done ("Staff lines 3 px apart, enlarged 6.7× to 20 px").
4. **Read**: pages are packed into one 300 dpi JPEG PDF (`scan.pagesToPdf`) so Audiveris treats them as one score. The desktop shell runs `Audiveris.exe -batch -export -output <tmp> -- scan.pdf` and returns the `.mxl`. In a browser there is no reader: "Download prepared pages" gives the enlarged PNGs for Audiveris by hand.
5. **Review**: the first original page sits beside the app's reading; the song keeps the page images (`song.scanPages`) and the MusicXML (`song.scanXml`, downloadable).

Real example: the River Flows In You scan is 510×722 px, staff lines 3 px apart → enlarged 6.7×. Audiveris itself has not been run on it in this sandbox (no Windows / no download access); the CI workflow runs a smoke test on `tests/scan/smoke_page.png`.

## Windows desktop app (`desktop/`)

Electron shell around the built HTML (`desktop/app/index.html`), Web MIDI allowed for the local page only, sandboxed preload exposing `window.wapiroDesktop` (`omr`, `cancelOmr`, `omrAvailable`, `onOpenFile`). Audiveris (AGPLv3, with its own Java) is unpacked from the official MSI into `resources/audiveris` and runs as a separate process. electron-builder makes a per-user NSIS installer (no admin), a portable exe and a zip. `.github/workflows/build-windows.yml` builds it all on a Windows runner and uploads `MarkSteady-Wapiro-Windows.zip` (draft release on `v*` tags). Builds are unsigned, so SmartScreen warns on first run.
