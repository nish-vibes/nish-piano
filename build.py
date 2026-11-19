#!/usr/bin/env python3
"""Assemble the single-file app: src/index.template.html + CSS + JS -> dist/*.html"""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
CSS = ['assets/suite-core.css', 'src/app.css', 'src/sheet.css']
JS = [
    'assets/glyphs.js',
    'src/core-util.js', 'src/core-midi.js', 'src/core-notation.js', 'src/core-musicxml.js',
    'src/core-pdf.js', 'src/core-api.js', 'src/builtin.js', 'src/storage.js',
    'src/audio.js', 'src/engine.js', 'src/input.js',
    'src/keyboard.js', 'src/waterfall.js',
    'src/sheet-layout.js', 'src/sheet-render.js',
    'src/ui-base.js', 'src/ui-timeline.js', 'src/ui-popovers.js', 'src/scan.js', 'src/ui-fix.js', 'src/ui-library.js', 'src/ui-results.js', 'src/ui-editor.js', 'src/ui-shell.js', 'src/freeplay.js',
    'src/app.js',
]
OUT = 'dist/nish_marksteady_piano_v2_0_0.html'

def read(p):
    with open(os.path.join(HERE, p), encoding='utf-8') as f:
        return f.read()

def esc_script(s):
    return re.sub(r'</(script)', r'<\\/\1', s, flags=re.I)

tpl = read('src/index.template.html')
css = '\n'.join(read(p) for p in CSS if os.path.exists(os.path.join(HERE, p)))
js = '\n'.join('/* ---- %s ---- */\n%s' % (p, read(p)) for p in JS if os.path.exists(os.path.join(HERE, p)))
PDFJS = os.path.join(os.environ.get('PDFJS_BUILD', '/opt/npm-tools/node_modules/pdfjs-dist/legacy/build'), '')
def block(id_, path):
    src = open(path, encoding='utf-8').read()
    assert '</script' not in src.lower() and '<!--' not in src
    return '<script type="text/plain" id="%s">\n%s\n</script>' % (id_, src)
lic = '<!-- PDF reader: pdf.js 6.2.108 by Mozilla, Apache License 2.0 -->'
blocks = lic + '\n' + block('pdfjs-main', PDFJS + 'pdf.min.mjs') + '\n' + block('pdfjs-worker', PDFJS + 'pdf.worker.min.mjs')
html = tpl.replace('<!--__PDFJS__-->', blocks).replace('/*__CSS__*/', css.replace('\\', '\\\\') if False else css).replace('/*__JS__*/', esc_script(js))
os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
with open(os.path.join(HERE, OUT), 'w', encoding='utf-8') as f:
    f.write(html)
print('wrote', OUT, len(html), 'bytes')
