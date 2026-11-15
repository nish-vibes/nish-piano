#!/usr/bin/env python3
"""Build a small SMuFL-encoded test font from GNU FreeFont outlines (tests only, never shipped).
Each glyph is shifted so its SMuFL anchor (staff position) sits on the baseline at x = 0, like Bravura/Leland."""
import json, os
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
HERE = os.path.dirname(os.path.abspath(__file__))
src = TTFont('/usr/share/fonts/truetype/freefont/FreeSerif.ttf'); gs = src.getGlyphSet(); cm = src.getBestCmap()
# name: (source codepoint, SMuFL codepoint, anchor x, anchor y, mirror)
T = {
 'noteheadBlack': (0x1D158, 0xE0A4, 35, 91, 0), 'noteheadVoid': (0x1D157, 0xE0A3, 35, 91, 0), 'noteWhole': (0x1D15D, 0xE0A2, 38, 90, 0),
 'sharp': (0x266F, 0xE262, 50, 198, 0), 'natural': (0x266E, 0xE261, 56, 192.5, 0), 'flat': (0x266D, 0xE260, 56, 133.2, 0),
 'doubleSharp': (0x1D12A, 0xE263, 37, 179.5, 0), 'doubleFlat': (0x1D12B, 0xE264, 56, 133.2, 0),
 'gClef': (0x1D11E, 0xE050, 120, 232, 0), 'fClef': (0x1D122, 0xE062, 75, 481.5, 0),
 'restWhole': (0x1D13B, 0xE4E3, 12, 572, 0), 'restHalf': (0x1D13C, 0xE4E4, 12, 358, 0), 'restQuarter': (0x1D13D, 0xE4E5, 55, 360, 0),
 'rest8th': (0x1D13E, 0xE4E6, 19, 349, 0), 'rest16th': (0x1D13F, 0xE4E7, 19, 254, 0), 'rest32nd': (0x1D140, 0xE4E8, 19, 348.5, 0),
 'flag8thUp': (0x1D16E, 0xE240, 0, 767, 0), 'flag16thUp': (0x1D16F, 0xE242, 0, 767, 0), 'flag32ndUp': (0x1D170, 0xE244, 0, 896, 0),
 'flag8thDown': (0x1D16E, 0xE241, 0, 767, 1), 'flag16thDown': (0x1D16F, 0xE243, 0, 767, 1), 'flag32ndDown': (0x1D170, 0xE245, 0, 896, 1),
}
order = ['.notdef'] + list(T)
glyphs, metrics, cmap = {}, {}, {}
glyphs['.notdef'] = TTGlyphPen(None).glyph(); metrics['.notdef'] = (500, 0)
for name, (scp, dcp, ax, ay, mir) in T.items():
    g = gs[cm[scp]]
    pen = TTGlyphPen(None)
    tr = (1, 0, 0, -1, -ax, ay) if mir else (1, 0, 0, 1, -ax, -ay)
    rec = DecomposingRecordingPen(gs); g.draw(rec); rec.replay(TransformPen(pen, tr))
    glyphs[name] = pen.glyph(); metrics[name] = (g.width, 0); cmap[dcp] = name
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(order); fb.setupCharacterMap(cmap); fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics(metrics); fb.setupHorizontalHeader(ascent=1200, descent=-1200)
fb.setupNameTable({'familyName': 'WapiroTestSMuFL', 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=1200, sTypoDescender=-1200, usWinAscent=1200, usWinDescent=1200); fb.setupPost()
out = os.path.join(HERE, 'WapiroTestSMuFL.ttf'); fb.save(out)
json.dump({k: [v[1], v[2], v[3]] for k, v in T.items()}, open(os.path.join(HERE, 'smufl_map.json'), 'w'))
print('wrote', out, os.path.getsize(out), 'bytes')
