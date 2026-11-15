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

## Known limits
- Real MIDI keyboard, audio and touch not tested on hardware.
- Results bar strip uses hatched patterns plus numbers; colours are tokens with transparency.
