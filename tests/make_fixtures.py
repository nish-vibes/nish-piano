#!/usr/bin/env python3
"""Stand-in acceptance fixtures for MarkSteady Wapiro v2.0.

The tester's real PDF/MIDI files are not available, so these files replace them.
Each fixture is defined ONCE here as plain data; both the file and its expected
import result are derived from that definition, so the expectation never comes
from the importer under test.

Run:  python3 -I tests/make_fixtures.py     (writes ../fixtures/*)
"""
import json, os, struct, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'fixtures'))
os.makedirs(OUT, exist_ok=True)

STEP = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
DIA = {'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6}


def pp(p):
    """'Bb4' -> (step, alter, octave, midi). '#' sharp, 'b' flat, 'x' double sharp."""
    step, rest, alter = p[0], p[1:], 0
    while rest[0] in '#bx':
        alter += {'#': 1, 'b': -1, 'x': 2}[rest[0]]
        rest = rest[1:]
    octv = int(rest)
    return step, alter, octv, (octv + 1) * 12 + STEP[step] + alter


class Ev:
    def __init__(self, pitches, dur, typ, dots=0, tie=None, beam=None, tup=None,
                 tupmark=None, acc=None, stem=None):
        if pitches is None:
            self.pitches = []
        elif isinstance(pitches, str):
            self.pitches = [pitches]
        else:
            self.pitches = list(pitches)
        self.dur, self.typ, self.dots = dur, typ, dots
        self.tie, self.beam, self.tup, self.tupmark = tie, beam, tup, tupmark
        self.acc, self.stem = acc, stem


def N(p, dur, typ, **kw):
    return Ev(p, dur, typ, **kw)


def R(dur, typ, **kw):
    return Ev(None, dur, typ, **kw)


def auto_stem(ev, staff):
    mid = (4 * 7 + DIA['B']) if staff == 1 else (3 * 7 + DIA['D'])
    far = max((abs(o * 7 + DIA[s] - mid), o * 7 + DIA[s] - mid) for s, _, o, _ in map(pp, ev.pitches))
    return 'down' if far[1] >= 0 else 'up'


def note_xml(ev, staff, voice):
    out = []
    targets = ev.pitches or [None]
    for i, p in enumerate(targets):
        x = ['<note>']
        if i > 0:
            x.append('<chord/>')
        if p is None:
            x.append('<rest/>')
        else:
            s, a, o, _ = pp(p)
            x.append('<pitch><step>%s</step>%s<octave>%d</octave></pitch>' %
                     (s, ('<alter>%d</alter>' % a) if a else '', o))
        x.append('<duration>%d</duration>' % ev.dur)
        if p is not None and ev.tie in ('stop', 'both'):
            x.append('<tie type="stop"/>')
        if p is not None and ev.tie in ('start', 'both'):
            x.append('<tie type="start"/>')
        x.append('<voice>%d</voice>' % voice)
        x.append('<type>%s</type>' % ev.typ)
        x.extend(['<dot/>'] * ev.dots)
        if p is not None and ev.acc:
            x.append('<accidental>%s</accidental>' % ev.acc)
        if ev.tup:
            x.append('<time-modification><actual-notes>%d</actual-notes><normal-notes>%d</normal-notes></time-modification>' % ev.tup)
        if p is not None and ev.typ != 'whole':
            x.append('<stem>%s</stem>' % (ev.stem or auto_stem(ev, staff)))
        x.append('<staff>%d</staff>' % staff)
        if p is not None and ev.beam and i == 0:
            for lvl, b in enumerate(ev.beam, 1):
                x.append('<beam number="%d">%s</beam>' % (lvl, b))
        nots = []
        if p is not None and ev.tie in ('stop', 'both'):
            nots.append('<tied type="stop"/>')
        if p is not None and ev.tie in ('start', 'both'):
            nots.append('<tied type="start"/>')
        if ev.tupmark and i == 0:
            nots.append('<tuplet type="%s" bracket="no"/>' % ev.tupmark)
        if nots:
            x.append('<notations>%s</notations>' % ''.join(nots))
        x.append('</note>')
        out.append(''.join(x))
    return '\n      '.join(out)


def attrs_xml(a, div, staves, first):
    x = ['<attributes>']
    if first:
        x.append('<divisions>%d</divisions>' % div)
    if 'key' in a:
        x.append('<key><fifths>%d</fifths></key>' % a['key'])
    if 'time' in a:
        x.append('<time><beats>%d</beats><beat-type>%d</beat-type></time>' % a['time'])
    if first:
        if staves == 2:
            x.append('<staves>2</staves>')
            x.append('<clef number="1"><sign>G</sign><line>2</line></clef>')
            x.append('<clef number="2"><sign>F</sign><line>4</line></clef>')
        else:
            x.append(a.get('clef', '<clef><sign>G</sign><line>2</line></clef>'))
    x.append('</attributes>')
    return ''.join(x)


def score_xml(sc):
    div = sc['div']
    x = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
         '<score-partwise version="4.0">',
         '  <work><work-title>%s</work-title></work>' % sc['title'],
         '  <identification><creator type="composer">%s</creator><encoding><software>Wapiro fixture generator</software></encoding></identification>' % sc['composer'],
         '  <part-list>']
    for p in sc['parts']:
        x.append('    <score-part id="%s"><part-name>%s</part-name></score-part>' % (p['id'], p['name']))
    x.append('  </part-list>')
    for p in sc['parts']:
        x.append('  <part id="%s">' % p['id'])
        for mi, m in enumerate(p['measures']):
            x.append('    <measure number="%s"%s>' % (m['num'], ' implicit="yes"' if m.get('implicit') else ''))
            if m.get('left'):
                x.append('      ' + m['left'])
            a = m.get('attrs')
            if a or mi == 0:
                x.append('      ' + attrs_xml(a or {}, div, p['staves'], mi == 0))
            if m.get('tempo'):
                x.append('      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>%d</per-minute></metronome></direction-type><staff>1</staff><sound tempo="%d"/></direction>' % (m['tempo'], m['tempo']))
            for si, (staff, voice, evs) in enumerate(m['seqs']):
                if si > 0:
                    prev = sum(e.dur for e in m['seqs'][si - 1][2])
                    x.append('      <backup><duration>%d</duration></backup>' % prev)
                for e in evs:
                    x.append('      ' + note_xml(e, staff, voice))
            if m.get('right'):
                x.append('      ' + m['right'])
            x.append('    </measure>')
        x.append('  </part>')
    x.append('</score-partwise>')
    return '\n'.join(x) + '\n'


def r6(v):
    return round(v + 0.0, 6)


def expected_from_score(sc):
    div = sc['div']
    p0 = sc['parts'][0]
    notes, measures, tempos, timesigs, keysigs = [], [], [], [], []
    cur = {'time': None, 'key': None, 'tempo': None}
    q = 0.0
    for idx in sc['order']:
        m0 = p0['measures'][idx]
        a = m0.get('attrs') or {}
        if 'key' in a and a['key'] != cur['key']:
            cur['key'] = a['key']
            keysigs.append({'q': r6(q), 'fifths': a['key']})
        if 'time' in a and a['time'] != cur['time']:
            cur['time'] = a['time']
            timesigs.append({'q': r6(q), 'num': a['time'][0], 'den': a['time'][1]})
        if m0.get('tempo') and m0['tempo'] != cur['tempo']:
            cur['tempo'] = m0['tempo']
            tempos.append({'q': r6(q), 'bpm': m0['tempo']})
        lenq = m0['len'] / div
        measures.append({'q': r6(q), 'lenQ': r6(lenq)})
        for p in sc['parts']:
            m = p['measures'][idx]
            for staff, voice, evs in m['seqs']:
                assert sum(e.dur for e in evs) == m['len'], (sc['file'], p['id'], m['num'], staff, voice, sum(e.dur for e in evs), m['len'])
                pos = 0
                for e in evs:
                    for pitch in e.pitches:
                        notes.append({'q': q + pos / div, 'durQ': e.dur / div, 'midi': pp(pitch)[3],
                                      'hand': p['hands'][staff], 'spelled': pitch, 'tie': e.tie})
                    pos += e.dur
        q += lenq
    notes.sort(key=lambda n: (n['q'], n['midi']))
    out, used = [], set()
    for i, n in enumerate(notes):
        if i in used:
            continue
        c = dict(n)
        t = n['tie']
        while t in ('start', 'both'):
            end = c['q'] + c['durQ']
            j = next((k for k in range(len(notes)) if k not in used and k != i and notes[k]['midi'] == n['midi']
                      and notes[k]['hand'] == n['hand'] and abs(notes[k]['q'] - end) < 1e-6
                      and notes[k]['tie'] in ('stop', 'both')), None)
            if j is None:
                break
            used.add(j)
            c['durQ'] += notes[j]['durQ']
            t = notes[j]['tie']
        out.append({'q': r6(c['q']), 'durQ': r6(c['durQ']), 'midi': c['midi'], 'hand': c['hand'], 'spelled': c['spelled']})
    return {'file': sc['file'], 'kind': 'musicxml', 'title': sc['title'], 'composer': sc['composer'],
            'exactNotation': True, 'handsGuessed': False, 'keySigs': keysigs, 'timeSigs': timesigs,
            'tempos': tempos, 'measures': measures, 'notes': out}


TWO = {1: 'R', 2: 'L'}
fixtures = []

# ---------------------------------------------------------------- x1: basics
x1 = {'file': 'x1_c_major_basics.musicxml', 'title': 'Fixture 1 - C major basics', 'composer': 'Wapiro tests', 'div': 4,
      'order': [0, 1, 2, 3],
      'parts': [{'id': 'P1', 'name': 'Piano', 'staves': 2, 'hands': TWO, 'measures': [
          {'num': '1', 'len': 16, 'attrs': {'key': 0, 'time': (4, 4)}, 'tempo': 100, 'seqs': [
              (1, 1, [N('C5', 4, 'quarter'), N('D5', 2, 'eighth', beam=['begin']), N('E5', 2, 'eighth', beam=['end']),
                      N('F5', 6, 'quarter', dots=1), N('G5', 2, 'eighth')]),
              (2, 5, [N('C3', 8, 'half'), N(['E3', 'G3'], 8, 'half')])]},
          {'num': '2', 'len': 16, 'seqs': [
              (1, 1, [R(4, 'quarter'), N('A5', 4, 'quarter'), N('G5', 8, 'half')]),
              (2, 5, [N('C3', 16, 'whole')])]},
          {'num': '3', 'len': 16, 'seqs': [
              (1, 1, [N('E5', 1, '16th', beam=['begin', 'begin']), N('F5', 1, '16th', beam=['continue', 'continue']),
                      N('G5', 1, '16th', beam=['continue', 'continue']), N('A5', 1, '16th', beam=['end', 'end']),
                      N('G5', 4, 'quarter'), N('E5', 8, 'half')]),
              (2, 5, [N('G2', 4, 'quarter'), R(4, 'quarter'), N(['C3', 'G3'], 8, 'half')])]},
          {'num': '4', 'len': 16, 'right': '<barline location="right"><bar-style>light-heavy</bar-style></barline>', 'seqs': [
              (1, 1, [N('C5', 16, 'whole')]),
              (2, 5, [N(['C3', 'E3', 'G3'], 16, 'whole')])]},
      ]}]}

# ------------------------------------------------- x2: flats, accidentals, LH above middle C
x2 = {'file': 'x2_bflat_spelling.musicxml', 'title': 'Fixture 2 - B flat spelling', 'composer': 'Wapiro tests', 'div': 2,
      'order': [0, 1, 2],
      'parts': [{'id': 'P1', 'name': 'Piano', 'staves': 2, 'hands': TWO, 'measures': [
          {'num': '1', 'len': 6, 'attrs': {'key': -2, 'time': (3, 4)}, 'tempo': 96, 'seqs': [
              (1, 1, [N('Bb4', 2, 'quarter'), N('D5', 2, 'quarter'), N('Eb5', 2, 'quarter')]),
              (2, 5, [N('Bb2', 6, 'half', dots=1)])]},
          {'num': '2', 'len': 6, 'seqs': [
              (1, 1, [N('E5', 2, 'quarter', acc='natural'), N('F#5', 2, 'quarter', acc='sharp'), N('G5', 2, 'quarter')]),
              (2, 5, [N(['Eb3', 'G3'], 4, 'half'), N('D3', 2, 'quarter')])]},
          {'num': '3', 'len': 6, 'right': '<barline location="right"><bar-style>light-heavy</bar-style></barline>', 'seqs': [
              (1, 1, [N('Ab4', 2, 'quarter', acc='flat'), N('Bb4', 4, 'half')]),
              (2, 5, [N('D4', 2, 'quarter'), N('Eb4', 2, 'quarter'), N('F4', 2, 'quarter')])]},
      ]}]}

# ------------------------------------------------- x3: 6/8 -> 3/4, tie over barline, triplets, 16ths
x3 = {'file': 'x3_meter_change_ties_triplets.musicxml', 'title': 'Fixture 3 - Meter change, ties, triplets', 'composer': 'Wapiro tests', 'div': 12,
      'order': [0, 1, 2, 3],
      'parts': [{'id': 'P1', 'name': 'Piano', 'staves': 2, 'hands': TWO, 'measures': [
          {'num': '1', 'len': 36, 'attrs': {'key': 1, 'time': (6, 8)}, 'tempo': 108, 'seqs': [
              (1, 1, [N('D5', 6, 'eighth', beam=['begin']), N('E5', 6, 'eighth', beam=['continue']), N('G5', 6, 'eighth', beam=['end']),
                      N('B5', 18, 'quarter', dots=1, tie='start')]),
              (2, 5, [N('G2', 18, 'quarter', dots=1), N('D3', 18, 'quarter', dots=1)])]},
          {'num': '2', 'len': 36, 'seqs': [
              (1, 1, [N('B5', 18, 'quarter', dots=1, tie='stop'), N('A5', 6, 'eighth', beam=['begin']),
                      N('G5', 6, 'eighth', beam=['continue']), N('F#5', 6, 'eighth', beam=['end'])]),
              (2, 5, [N(['G2', 'D3'], 36, 'half', dots=1)])]},
          {'num': '3', 'len': 36, 'attrs': {'time': (3, 4)}, 'seqs': [
              (1, 1, [N('G5', 4, 'eighth', tup=(3, 2), tupmark='start', beam=['begin']), N('A5', 4, 'eighth', tup=(3, 2), beam=['continue']),
                      N('B5', 4, 'eighth', tup=(3, 2), tupmark='stop', beam=['end']),
                      N('D6', 12, 'quarter'),
                      N('C6', 3, '16th', beam=['begin', 'begin']), N('B5', 3, '16th', beam=['continue', 'continue']),
                      N('A5', 3, '16th', beam=['continue', 'continue']), N('G5', 3, '16th', beam=['end', 'end'])]),
              (2, 5, [N('G3', 24, 'half'), N('D3', 12, 'quarter')])]},
          {'num': '4', 'len': 36, 'right': '<barline location="right"><bar-style>light-heavy</bar-style></barline>', 'seqs': [
              (1, 1, [N('G5', 36, 'half', dots=1)]),
              (2, 5, [N('G2', 36, 'half', dots=1)])]},
      ]}]}

# ------------------------------------------------- x4: pickup bar, two voices, repeat with 1st/2nd ending, tempo change
x4 = {'file': 'x4_voices_pickup_repeat.musicxml', 'title': 'Fixture 4 - Voices, pickup, repeat', 'composer': 'Wapiro tests', 'div': 2,
      'order': [0, 1, 2, 1, 3, 4],
      'parts': [{'id': 'P1', 'name': 'Piano', 'staves': 2, 'hands': TWO, 'measures': [
          {'num': '0', 'len': 2, 'implicit': True, 'attrs': {'key': -1, 'time': (4, 4)}, 'tempo': 88, 'seqs': [
              (1, 1, [N('C5', 2, 'quarter')]),
              (2, 5, [R(2, 'quarter')])]},
          {'num': '1', 'len': 8, 'left': '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>', 'seqs': [
              (1, 1, [N('F5', 4, 'half', stem='up'), N('A5', 4, 'half', stem='up')]),
              (1, 2, [N('A3', 2, 'quarter', stem='down'), N('Bb3', 2, 'quarter', stem='down'),
                      N('C4', 2, 'quarter', stem='down'), N('D4', 2, 'quarter', stem='down')]),
              (2, 5, [N('F3', 8, 'whole')])]},
          {'num': '2', 'len': 8, 'left': '<barline location="left"><ending number="1" type="start"/></barline>',
           'right': '<barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/></barline>', 'seqs': [
              (1, 1, [N('G5', 8, 'whole')]),
              (2, 5, [N(['C3', 'E3'], 8, 'whole')])]},
          {'num': '3', 'len': 8, 'tempo': 120, 'left': '<barline location="left"><ending number="2" type="start"/></barline>',
           'right': '<barline location="right"><ending number="2" type="discontinue"/></barline>', 'seqs': [
              (1, 1, [N('A5', 8, 'whole')]),
              (2, 5, [N('F3', 8, 'whole')])]},
          {'num': '4', 'len': 8, 'right': '<barline location="right"><bar-style>light-heavy</bar-style></barline>', 'seqs': [
              (1, 1, [N('F5', 8, 'whole')]),
              (2, 5, [N(['F2', 'C3'], 8, 'whole')])]},
      ]}]}

# ------------------------------------------------- x5: full 88-key range, seconds in chords
x5 = {'file': 'x5_range_and_chords.musicxml', 'title': 'Fixture 5 - Range and chords', 'composer': 'Wapiro tests', 'div': 1,
      'order': [0, 1],
      'parts': [{'id': 'P1', 'name': 'Piano', 'staves': 2, 'hands': TWO, 'measures': [
          {'num': '1', 'len': 4, 'attrs': {'key': 0, 'time': (4, 4)}, 'tempo': 60, 'seqs': [
              (1, 1, [N('C8', 4, 'whole')]),
              (2, 5, [N('A0', 4, 'whole')])]},
          {'num': '2', 'len': 4, 'right': '<barline location="right"><bar-style>light-heavy</bar-style></barline>', 'seqs': [
              (1, 1, [N(['E5', 'F5'], 2, 'half'), N(['C5', 'E5', 'G5', 'C6'], 2, 'half')]),
              (2, 5, [N(['C2', 'C3'], 4, 'whole')])]},
      ]}]}

# ------------------------------------------------- x6: two single-staff parts (part 1 = right hand, part 2 = left hand)
x6 = {'file': 'x6_two_parts.musicxml', 'title': 'Fixture 6 - Two parts', 'composer': 'Wapiro tests', 'div': 1,
      'order': [0, 1],
      'parts': [
          {'id': 'P1', 'name': 'Right hand', 'staves': 1, 'hands': {1: 'R'}, 'measures': [
              {'num': '1', 'len': 3, 'attrs': {'key': 2, 'time': (3, 4)}, 'tempo': 120, 'seqs': [
                  (1, 1, [N('D5', 1, 'quarter'), N('F#5', 1, 'quarter'), N('A5', 1, 'quarter')])]},
              {'num': '2', 'len': 3, 'right': '<barline location="right"><bar-style>light-heavy</bar-style></barline>', 'seqs': [
                  (1, 1, [N('D5', 3, 'half', dots=1)])]}]},
          {'id': 'P2', 'name': 'Left hand', 'staves': 1, 'hands': {1: 'L'}, 'measures': [
              {'num': '1', 'len': 3, 'attrs': {'key': 2, 'time': (3, 4), 'clef': '<clef><sign>F</sign><line>4</line></clef>'}, 'seqs': [
                  (1, 1, [N('D3', 3, 'half', dots=1)])]},
              {'num': '2', 'len': 3, 'right': '<barline location="right"><bar-style>light-heavy</bar-style></barline>', 'seqs': [
                  (1, 1, [N(['D3', 'A3'], 3, 'half', dots=1)])]}]},
      ]}

for sc in (x1, x2, x3, x4, x5, x6):
    xml = score_xml(sc)
    with open(os.path.join(OUT, sc['file']), 'w', encoding='utf-8') as fh:
        fh.write(xml)
    fixtures.append(expected_from_score(sc))

# compressed MusicXML (.mxl) of fixture 1
mxl_name = 'x1_c_major_basics.mxl'
with zipfile.ZipFile(os.path.join(OUT, mxl_name), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('META-INF/container.xml',
               '<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>\n')
    z.writestr('score.musicxml', score_xml(x1))
e = dict(expected_from_score(x1)); e['file'] = mxl_name; e['kind'] = 'mxl'
fixtures.append(e)


# ======================================================================= MIDI
PPQ = 480


def vlq(n):
    b = [n & 0x7F]
    n >>= 7
    while n:
        b.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(b))


def meta_tempo(bpm):
    return b'\xff\x51\x03' + struct.pack('>I', round(60000000 / bpm))[1:]


def meta_timesig(num, den):
    return b'\xff\x58\x04' + bytes([num, {1: 0, 2: 1, 4: 2, 8: 3, 16: 4}[den], 24, 8])


def meta_keysig(fifths, minor=0):
    return b'\xff\x59\x02' + bytes([fifths & 0xFF, minor])


def meta_name(text):
    t = text.encode('ascii')
    return b'\xff\x03' + vlq(len(t)) + t


def tk(q):
    return round(q * PPQ)


def track_bytes(events, running=False):
    """events: list of (tick, order, bytes). order: 0 meta, 1 note-off, 2 controller, 3 note-on."""
    data, last, status = b'', 0, None
    for tick, _, b in sorted(events, key=lambda e: (e[0], e[1])):
        data += vlq(tick - last)
        last = tick
        if b[0] == 0xFF:
            status = None
            data += b
        elif running and b[0] == status:
            data += b[1:]
        else:
            status = b[0]
            data += b
    data += vlq(0) + b'\xff\x2f\x00'
    return b'MTrk' + struct.pack('>I', len(data)) + data


def note_events(notes, ch=0, off_as_on0=False):
    ev = []
    for q, d, m in notes:
        ev.append((tk(q), 3, bytes([0x90 | ch, m, 84])))
        ev.append((tk(q + d), 1, bytes([0x90 | ch, m, 0]) if off_as_on0 else bytes([0x80 | ch, m, 64])))
    return ev


def midi_file(fmt, tracks):
    return b'MThd' + struct.pack('>IHHH', 6, fmt, len(tracks), PPQ) + b''.join(tracks)


def exp_notes(lists):
    out = []
    for hand, notes, spell in lists:
        for i, (q, d, m) in enumerate(notes):
            n = {'q': r6(q), 'durQ': r6(d), 'midi': m}
            if hand:
                n['hand'] = hand
            if spell:
                n['spelled'] = spell[i]
            out.append(n)
    out.sort(key=lambda n: (n['q'], n['midi']))
    return out


# m1: format 1, conductor track + "Right Hand" + "Left Hand" (same channel). 3/4, B flat major, 96 bpm.
# The right hand dips below middle C and the left hand rises above it: hands must come from the tracks.
m1_rh = [(0, 1, 70), (1, 1, 74), (2, 1, 75), (3, 1, 58), (4, 1, 57), (5, 1, 58), (6, 2, 77), (8, 1, 74), (9, 3, 70)]
m1_rh_sp = ['Bb4', 'D5', 'Eb5', 'Bb3', 'A3', 'Bb3', 'F5', 'D5', 'Bb4']
m1_lh = [(0, 3, 46), (3, 1, 62), (4, 1, 63), (5, 1, 65), (6, 3, 51), (6, 3, 58), (9, 3, 46), (9, 3, 53)]
m1_lh_sp = ['Bb2', 'D4', 'Eb4', 'F4', 'Eb3', 'Bb3', 'Bb2', 'F3']
with open(os.path.join(OUT, 'm1_two_hands_bflat_3-4.mid'), 'wb') as fh:
    fh.write(midi_file(1, [
        track_bytes([(0, 0, meta_name('Conductor')), (0, 0, meta_tempo(96)), (0, 0, meta_timesig(3, 4)), (0, 0, meta_keysig(-2))]),
        track_bytes([(0, 0, meta_name('Right Hand'))] + note_events(m1_rh)),
        track_bytes([(0, 0, meta_name('Left Hand'))] + note_events(m1_lh)),
    ]))
fixtures.append({'file': 'm1_two_hands_bflat_3-4.mid', 'kind': 'midi', 'exactNotation': False, 'handsGuessed': False,
                 'keySigs': [{'q': 0, 'fifths': -2}], 'timeSigs': [{'q': 0, 'num': 3, 'den': 4}], 'tempos': [{'q': 0, 'bpm': 96}],
                 'measures': [{'q': 0, 'lenQ': 3}, {'q': 3, 'lenQ': 3}, {'q': 6, 'lenQ': 3}, {'q': 9, 'lenQ': 3}],
                 'notes': exp_notes([('R', m1_rh, m1_rh_sp), ('L', m1_lh, m1_lh_sp)])})

# m2: format 0, one track, running status, note-off written as note-on velocity 0.
# 6/8 for two bars, then 2/4 with eighth-note triplets; tempo 120 then 100. Hands are not given by the file.
T = 1 / 3
m2_notes = [(0, 0.5, 67), (0.5, 0.5, 71), (1, 0.5, 74), (1.5, 1.5, 79), (0, 1.5, 43), (1.5, 1.5, 50),
            (3, 1.5, 78), (4.5, 0.5, 76), (5, 0.5, 74), (5.5, 0.5, 72), (3, 3, 43),
            (6, T, 67), (6 + T, T, 69), (6 + 2 * T, T, 71), (7, T, 72), (7 + T, T, 71), (7 + 2 * T, T, 69), (6, 2, 55),
            (8, 2, 67), (8, 2, 43)]
with open(os.path.join(OUT, 'm2_format0_6-8_triplets.mid'), 'wb') as fh:
    fh.write(midi_file(0, [track_bytes(
        [(0, 0, meta_tempo(120)), (0, 0, meta_timesig(6, 8)), (0, 0, meta_keysig(1)),
         (tk(6), 0, meta_timesig(2, 4)), (tk(6), 0, meta_tempo(100))] + note_events(m2_notes, off_as_on0=True), running=True)]))
fixtures.append({'file': 'm2_format0_6-8_triplets.mid', 'kind': 'midi', 'exactNotation': False, 'handsGuessed': True,
                 'keySigs': [{'q': 0, 'fifths': 1}], 'timeSigs': [{'q': 0, 'num': 6, 'den': 8}, {'q': 6, 'num': 2, 'den': 4}],
                 'tempos': [{'q': 0, 'bpm': 120}, {'q': 6, 'bpm': 100}],
                 'measures': [{'q': 0, 'lenQ': 3}, {'q': 3, 'lenQ': 3}, {'q': 6, 'lenQ': 2}, {'q': 8, 'lenQ': 2}],
                 'notes': exp_notes([(None, m2_notes, None)])})

# m3: full piano range (A0 and C8 must keep their pitch), two tempos, sustain pedal, and a drum track on channel 10 that must be ignored.
m3_piano = [(0, 2, 21), (2, 2, 108), (4, 1, 60), (4, 1, 64), (4, 1, 67), (5, 1, 72), (6, 2, 36), (6, 2, 96)]
m3_drums = [(0, 0.25, 36), (1, 0.25, 38), (2, 0.25, 36), (3, 0.25, 38), (4, 0.25, 42), (5, 0.25, 42)]
with open(os.path.join(OUT, 'm3_range_tempo_pedal_drums.mid'), 'wb') as fh:
    fh.write(midi_file(1, [
        track_bytes([(0, 0, meta_tempo(60)), (0, 0, meta_timesig(4, 4)), (tk(4), 0, meta_tempo(120))]),
        track_bytes([(0, 0, meta_name('Piano')), (0, 2, bytes([0xB0, 64, 127])), (tk(3.5), 2, bytes([0xB0, 64, 0]))] + note_events(m3_piano)),
        track_bytes([(0, 0, meta_name('Drums'))] + note_events(m3_drums, ch=9)),
    ]))
fixtures.append({'file': 'm3_range_tempo_pedal_drums.mid', 'kind': 'midi', 'exactNotation': False, 'handsGuessed': True,
                 'timeSigs': [{'q': 0, 'num': 4, 'den': 4}], 'tempos': [{'q': 0, 'bpm': 60}, {'q': 4, 'bpm': 120}],
                 'measures': [{'q': 0, 'lenQ': 4}, {'q': 4, 'lenQ': 4}],
                 'notes': exp_notes([(None, m3_piano, None)])})

# m4: a valid MIDI file with no notes. The importer must refuse it with a readable message.
with open(os.path.join(OUT, 'm4_no_notes.mid'), 'wb') as fh:
    fh.write(midi_file(1, [track_bytes([(0, 0, meta_tempo(120)), (0, 0, meta_timesig(4, 4))]), track_bytes([(0, 0, meta_name('Empty'))])]))
fixtures.append({'file': 'm4_no_notes.mid', 'kind': 'midi', 'error': True})

# not a music file at all
with open(os.path.join(OUT, 'bad_not_music.musicxml'), 'w') as fh:
    fh.write('<?xml version="1.0"?><html><body>not a score</body></html>')
fixtures.append({'file': 'bad_not_music.musicxml', 'kind': 'musicxml', 'error': True})

with open(os.path.join(OUT, 'expected.json'), 'w') as fh:
    json.dump({'tolerance': {'q': 0.004, 'bpm': 0.5}, 'fixtures': fixtures}, fh, indent=1)

for f in fixtures:
    print('%-40s %s' % (f['file'], 'must be rejected' if f.get('error') else '%d notes, %d bars' % (len(f['notes']), len(f['measures']))))
