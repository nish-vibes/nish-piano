#!/usr/bin/env python3
"""Turn an SFZ piano into a packed bank for the NiSH MarkSteady Piano native engine.

    python tools/build_piano.py <folder with the .sfz and samples> <output folder> --name "Upright Piano KW"

What it does, in order:
  1. Reads the SFZ (control/global/master/group/region headers, #define, #include, note names,
     default_path, note_offset/octave_offset). Keeps attack and release regions that play with the pedal up
     and on the first round-robin step.
  2. Decodes each sample (FLAC/WAV/OGG with the soundfile module; plain WAV also without it).
  3. Trims the silence recorded before each note. Latency is the app's first priority, and free piano sets
     often have 15 ms or more of near-silence before the hammer. The cut keeps 0.5 ms before the first
     sound so the attack is intact. The build fails if any attack sample would still start late.
  4. Normalises the bank so its loudest attack sample peaks at -1 dBFS.
  5. Writes index.txt and piano.pcm (16-bit), and copies the set's own readme/licence files.

SPDX-License-Identifier: GPL-3.0-or-later
"""
import argparse
import os
import re
import shutil
import struct
import sys
import wave

import numpy as np

PRE_ROLL_S = 0.0005        # keep this much before the first sound
ONSET_DB = -40.0           # first sound: the first sample above peak - 40 dB
MAX_LEAD_MS = 1.0          # after trimming, no attack sample may start later than this
NOTE_RE = re.compile(r'^([a-gA-G])([#b]?)(-?\d+)$')
NOTE_BASE = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}


def note_num(v, offset=0):
    v = v.strip()
    m = NOTE_RE.match(v)
    if m:
        n = NOTE_BASE[m.group(1).lower()] + (1 if m.group(2) == '#' else -1 if m.group(2) == 'b' else 0)
        return (int(m.group(3)) + 1) * 12 + n + offset   # SFZ: c4 = 60
    return int(float(v)) + offset


def read_sfz_text(path, defines, seen=None):
    seen = seen or set()
    real = os.path.realpath(path)
    if real in seen:
        return ''
    seen.add(real)
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read()
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    out = []
    for line in text.splitlines():
        line = re.sub(r'(^|\s)//.*$', ' ', line)
        m = re.match(r'\s*#define\s+(\$\w+)\s+(.*?)\s*$', line)
        if m:
            defines[m.group(1)] = m.group(2)
            continue
        m = re.match(r'\s*#include\s+"([^"]+)"', line)
        if m:
            inc = os.path.join(os.path.dirname(path), m.group(1).replace('\\', '/'))
            out.append(read_sfz_text(inc, defines, seen) if os.path.exists(inc) else '')
            continue
        for k in sorted(defines, key=len, reverse=True):
            line = line.replace(k, defines[k])
        out.append(line)
    return '\n'.join(out)


def parse_sfz(path):
    text = read_sfz_text(path, {})
    toks = list(re.finditer(r'<(\w+)>|([A-Za-z0-9_]+)=', text))
    control, glob, master, group, region = {}, {}, {}, {}, None
    current = None
    regions = []

    def flush():
        if region is not None:
            merged = {}
            for d in (glob, master, group, region):
                merged.update(d)
            merged['__control'] = dict(control)
            regions.append(merged)

    for i, t in enumerate(toks):
        if t.group(1):
            h = t.group(1).lower()
            flush()
            region = None
            if h == 'control':
                current = control
            elif h == 'global':
                glob, master, group = {}, {}, {}
                current = glob
            elif h == 'master':
                master, group = {}, {}
                current = master
            elif h == 'group':
                group = {}
                current = group
            elif h == 'region':
                region = {}
                current = region
            else:
                current = {}   # <curve>, <effect>, <midi>: ignored
            continue
        end = toks[i + 1].start() if i + 1 < len(toks) else len(text)
        val = text[t.end():end].strip()
        if current is not None:
            current[t.group(2).lower()] = val
    flush()
    return regions


def keep(r):
    """Attack/release regions that sound with the pedal up, first round robin, no CC-only triggers."""
    if r.get('sample', '').startswith('*'):
        return False
    trig = r.get('trigger', 'attack').lower()
    if trig not in ('attack', 'first', 'legato', 'release', 'release_key'):
        return False
    if any(k.startswith('on_locc') or k.startswith('on_hicc') for k in r):
        return False
    lo, hi = int(float(r.get('locc64', 0))), int(float(r.get('hicc64', 127)))
    if not (lo <= 0 <= hi):          # a region for the pedal held down: the engine uses the pedal-up set
        return False
    if int(float(r.get('seq_position', 1))) != 1:
        return False
    if float(r.get('lorand', 0)) > 0:
        return False
    return True


def find_file(base, rel):
    rel = rel.replace('\\', '/')
    p = os.path.join(base, rel)
    if os.path.exists(p):
        return p
    # case-insensitive walk (Windows-made sets on a case-sensitive disk)
    cur = base
    for part in rel.split('/'):
        if part in ('', '.'):
            continue
        try:
            names = {n.lower(): n for n in os.listdir(cur)}
        except OSError:
            return None
        if part.lower() not in names:
            return None
        cur = os.path.join(cur, names[part.lower()])
    return cur


def read_audio(path):
    try:
        import soundfile as sf
        data, rate = sf.read(path, dtype='float32', always_2d=True)
        return data, rate
    except ImportError:
        if not path.lower().endswith('.wav'):
            raise RuntimeError('Install the soundfile module to read ' + os.path.basename(path))
        with wave.open(path, 'rb') as w:
            ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(n)
        if width == 2:
            a = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
        elif width == 3:
            b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
            v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
            v = np.where(v & 0x800000, v - 0x1000000, v)
            a = v.astype(np.float32) / 8388608.0
        elif width == 4:
            a = np.frombuffer(raw, dtype='<i4').astype(np.float32) / 2147483648.0
        else:
            a = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128.0
        return a.reshape(-1, ch), rate


def onset(data, rate):
    env = np.max(np.abs(data), axis=1)
    peak = float(env.max()) if len(env) else 0.0
    if peak <= 0:
        return 0, 0.0
    thr = max(peak * 10 ** (ONSET_DB / 20), 8 / 32768)
    idx = int(np.argmax(env > thr))
    return idx, peak


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--name', default='Sampled piano')
    ap.add_argument('--sfz', help='which .sfz to use (default: the one with the most regions)')
    a = ap.parse_args()

    sfzs = []
    for root, _dirs, files in os.walk(a.src):
        for f in files:
            if f.lower().endswith('.sfz'):
                sfzs.append(os.path.join(root, f))
    if a.sfz:
        sfzs = [p for p in sfzs if os.path.basename(p) == a.sfz] or sfzs
    if not sfzs:
        sys.exit('No .sfz file found in ' + a.src)
    parsed = sorted(((len([r for r in parse_sfz(p) if keep(r)]), p) for p in sfzs), reverse=True)
    for n, p in parsed:
        print(f'  {n:4d} usable regions  {os.path.relpath(p, a.src)}')
    sfz = parsed[0][1]
    print('Using', os.path.relpath(sfz, a.src))
    base = os.path.dirname(sfz)
    regions = [r for r in parse_sfz(sfz) if keep(r)]

    samples, sample_ids, out_regions = [], {}, []
    leads_before, leads_after = [], []
    for r in regions:
        ctl = r['__control']
        noff = int(float(ctl.get('note_offset', 0))) + 12 * int(float(ctl.get('octave_offset', 0)))
        path = find_file(base, ctl.get('default_path', '').replace('\\', '/') + r['sample'])
        if not path:
            sys.exit('Missing sample: ' + r['sample'])
        if 'key' in r:
            k = note_num(r['key'], noff)
            lokey = hikey = key = k
        else:
            lokey, hikey, key = 0, 127, 60
        if 'lokey' in r: lokey = note_num(r['lokey'], noff)
        if 'hikey' in r: hikey = note_num(r['hikey'], noff)
        if 'pitch_keycenter' in r and r['pitch_keycenter'].lower() != 'sample': key = note_num(r['pitch_keycenter'], noff)
        lovel, hivel = int(float(r.get('lovel', 1))), int(float(r.get('hivel', 127)))
        release = r.get('trigger', 'attack').lower() in ('release', 'release_key')
        off = int(float(r.get('offset', 0)))
        endf = int(float(r['end'])) if 'end' in r else None
        loop_mode = r.get('loop_mode', r.get('loopmode', 'no_loop')).lower()
        ls = r.get('loop_start', r.get('loopstart'))
        le = r.get('loop_end', r.get('loopend'))
        loops = loop_mode in ('loop_continuous', 'loop_sustain') and ls is not None and le is not None
        sk = (path, off, endf, int(float(ls)) if loops else -1, int(float(le)) if loops else -1)
        if sk not in sample_ids:
            data, rate = read_audio(path)
            data = data[:, :2]
            data = data[off:(endf + 1 if endf is not None else None)]
            first, peak = onset(data, rate)
            start = max(0, first - int(round(PRE_ROLL_S * rate)))
            if not release:
                leads_before.append(first / rate * 1000)
                leads_after.append((first - start) / rate * 1000)
            data = data[start:]
            lstart = lend = -1
            if loops:
                lstart, lend = int(float(ls)) - off - start, int(float(le)) - off - start + 1
                if lstart < 0 or lend > len(data) or lend - lstart < 8:
                    lstart = lend = -1
            sample_ids[sk] = len(samples)
            samples.append({'data': data, 'rate': rate, 'loop': (lstart, lend), 'peak': peak, 'release': release, 'file': os.path.relpath(path, base)})
        tune = float(r.get('tune', 0)) + 100 * float(r.get('transpose', 0))
        gain = float(r.get('volume', 0))
        if 'amplitude' in r:
            gain += 20 * np.log10(max(1e-6, float(r['amplitude']) / 100))
        out_regions.append({
            'sample': sample_ids[sk], 'lokey': lokey, 'hikey': hikey, 'key': key, 'lovel': lovel, 'hivel': hivel,
            'release': release, 'tune': tune, 'gain': gain, 'veltrack': float(r.get('amp_veltrack', 100)),
            'rel': float(r.get('ampeg_release', 0.3 if not release else 0.1)), 'rtdecay': float(r.get('rt_decay', 0)),
        })

    attacks = [x for x in out_regions if not x['release']]
    if not attacks:
        sys.exit('The SFZ has no attack regions')
    # every key of an 88-key piano must have a sound
    missing = [k for k in range(21, 109) if not any(x['lokey'] <= k <= x['hikey'] for x in attacks)]
    if missing:
        sys.exit(f'No sample covers keys {missing[:10]}{"..." if len(missing) > 10 else ""}')
    worst = max(leads_after)
    if worst > MAX_LEAD_MS:
        sys.exit(f'An attack sample still starts {worst:.2f} ms late after trimming (limit {MAX_LEAD_MS} ms)')

    # loudest attack peaks at -1 dBFS (region volume included)
    loud = max(samples[x['sample']]['peak'] * 10 ** (x['gain'] / 20) for x in attacks)
    norm_db = 20 * np.log10(0.891 / loud) if loud > 0 else 0.0
    for x in out_regions:
        x['gain'] += norm_db

    os.makedirs(a.out, exist_ok=True)
    offset = 0
    with open(os.path.join(a.out, 'piano.pcm'), 'wb') as pcm, open(os.path.join(a.out, 'index.txt'), 'w', encoding='utf-8', newline='\n') as idx:
        idx.write(f'nishbank 1 {a.name}\n')
        for i, s in enumerate(samples):
            d = np.clip(np.round(s['data'] * 32767), -32768, 32767).astype('<i2')
            frames, ch = d.shape
            pcm.write(d.tobytes())
            idx.write(f's {i} {offset} {frames} {ch} {s["rate"]} {s["loop"][0]} {s["loop"][1]}\n')
            offset += frames * ch
        for x in out_regions:
            idx.write('r {sample} {lokey} {hikey} {key} {lovel} {hivel} {rel} {tune:.2f} {gain:.3f} {veltrack:.1f} {relt:.4f} {rtdecay:.3f}\n'.format(
                rel=1 if x['release'] else 0, relt=x['rel'], **{k: v for k, v in x.items() if k not in ('release', 'rel')}))
    for root, _dirs, files in os.walk(a.src):
        for f in files:
            if re.search(r'(readme|licen[cs]e|copying|credits|cc0|cc-by|public.?domain)', f, re.I) and f.lower().endswith(('.txt', '.md', '')):
                shutil.copy(os.path.join(root, f), os.path.join(a.out, 'source-' + f))

    mb = offset * 2 / 1048576
    layers = sorted({(x['lovel'], x['hivel']) for x in attacks})
    keys = sorted({x['key'] for x in attacks})
    rate = samples[0]['rate']
    print(f'{a.name}: {len(samples)} samples, {len(attacks)} attack and {len(out_regions) - len(attacks)} release regions')
    print(f'  {len(keys)} sampled notes, {len(layers)} velocity layers {layers}, {rate} Hz, {mb:.1f} MB of 16-bit PCM')
    print(f'  silence before the first sound: mean {np.mean(leads_before):.2f} ms, max {max(leads_before):.2f} ms before trimming;'
          f' max {worst:.2f} ms after')
    print(f'  loops on {sum(1 for s in samples if s["loop"][0] >= 0)} samples; normalised by {norm_db:+.1f} dB')


if __name__ == '__main__':
    main()
