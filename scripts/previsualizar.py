#!/usr/bin/env python3
"""Previsualiza los gráficos de una entrega sobre el encuadre vertical real del clip, sin el video.

Usa los fotogramas de muestra del proyecto (frames/, uno cada 10 s), aplica el mismo recorte
9:16 + zoom del encuadre del clip, captura el HTML del gráfico con Chrome (Playwright) fijando
el reloj de las animaciones, y compone una hoja de contactos por gráfico.

    python3 scripts/previsualizar.py <carpeta-proyecto> <entrega> [ids...] [--salida dir]
        [--instantes 0.3,1.2,3] [--plantillas carpeta]

Mismo motor que server/graficos.js: solo animaciones CSS / Web Animations; los datos llegan
en window.DATOS. Sirve para iterar aquí con Claude antes de renderizar en la PC o en FilmCraft.
"""
import json, sys, os, argparse, tempfile, pathlib
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('proyecto'); ap.add_argument('entrega'); ap.add_argument('ids', nargs='*')
ap.add_argument('--salida'); ap.add_argument('--instantes', default='0.4,1.5,3,fin')
ap.add_argument('--plantillas', default=str(pathlib.Path(__file__).resolve().parent.parent / 'plantillas'))
a = ap.parse_args()

P = pathlib.Path(a.proyecto)
meta = json.load(open(P / 'meta.json'))
plan = json.load(open(P / 'entregas' / a.entrega / 'clips.json'))
gj = json.load(open(P / 'entregas' / a.entrega / 'graficos.json'))
frames = json.load(open(P / 'frames.json'))['muestras']
salida = pathlib.Path(a.salida or (P / 'entregas' / a.entrega / 'previas')); salida.mkdir(parents=True, exist_ok=True)
W, H = plan['formato'].get('ancho', 1080), plan['formato'].get('alto', 1920)
srcW, srcH = meta['ancho'], meta['alto']
clips = {c['id']: c for c in plan['clips']}


def fondo(clip, t):
    """Fotograma de muestra más cercano a t, recortado como el encuadre del clip."""
    f = min(frames, key=lambda m: abs(m['t'] - t))
    im = Image.open(P / f['archivo']).convert('RGB').resize((srcW, srcH))
    enc = clip.get('encuadre') or plan.get('encuadre') or {}
    z = float(enc.get('zoom', 1)); anclaY = float(enc.get('anclaY', .5))
    centros = sorted(enc.get('centros', []), key=lambda c: c['t'])
    cx = srcW / 2
    if centros:
        cx = centros[0]['x']
        for p, q in zip(centros, centros[1:]):
            if p['t'] <= t <= q['t']:
                cx = p['x'] + (q['x'] - p['x']) * (t - p['t']) / max(1e-6, q['t'] - p['t'])
        if t >= centros[-1]['t']: cx = centros[-1]['x']
    for e in enc.get('enfasis', []):
        if e['in'] <= t <= e['out']: z *= float(e.get('zoom', 1.08))
    w9 = srcH * W / H
    cx = min(max(cx, w9 / 2), srcW - w9 / 2)
    vw, vh = w9 / z, srcH / z
    x0 = cx - vw / 2; y0 = (srcH - vh) * anclaY
    return im.crop((int(x0), int(y0), int(x0 + vw), int(y0 + vh))).resize((W, H), Image.LANCZOS)


def ruta_html(g):
    for base in (P / 'entregas' / a.entrega / 'graficos', pathlib.Path(a.plantillas)):
        if (base / g['archivo']).exists(): return (base / g['archivo']).resolve()
    raise SystemExit(f"no encuentro {g['archivo']}")


with sync_playwright() as pw:
    nav = pw.chromium.launch(args=['--no-sandbox', '--force-color-profile=srgb'])
    for g in gj['graficos']:
        if a.ids and g['id'] not in a.ids: continue
        clip = clips[g['clip']]
        dur = g['out'] - g['in']
        datos = dict(g.get('datos', {})); datos.setdefault('duracion', round(dur, 3))
        gw, gh = g.get('ancho', W), g.get('alto', H)
        pg = nav.new_page(viewport={'width': gw, 'height': gh}, device_scale_factor=1)
        pg.add_init_script(f'window.DATOS = {json.dumps(datos, ensure_ascii=False)}')
        pg.goto('file://' + str(ruta_html(g)), wait_until='networkidle')
        pg.evaluate('document.fonts && document.fonts.ready')
        insts = []
        for s in a.instantes.split(','):
            insts.append(max(0, dur - 0.05) if s.strip() == 'fin' else min(float(s), dur))
        cuadros = []
        for t in insts:
            pg.evaluate('(ms) => { document.getAnimations().forEach(an => { an.pause(); an.currentTime = ms }) }', t * 1000)
            png = tempfile.mktemp(suffix='.png')
            pg.screenshot(path=png, omit_background=True)
            capa = Image.open(png).convert('RGBA'); os.unlink(png)
            base = fondo(clip, g['in'] + t).convert('RGBA')
            base.alpha_composite(capa, (int(g.get('x', 0)), int(g.get('y', 0))))
            d = ImageDraw.Draw(base); d.rectangle((0, 0, 260, 54), fill=(0, 0, 0, 180))
            d.text((12, 14), f"{g['id']} · {t:.2f}s / {dur:.1f}s", fill=(255, 255, 0, 255))
            cuadros.append(base.resize((W // 3, H // 3)))
        pg.close()
        hoja = Image.new('RGB', (len(cuadros) * W // 3, H // 3), (20, 20, 20))
        for i, c in enumerate(cuadros): hoja.paste(c.convert('RGB'), (i * W // 3, 0))
        out = salida / f"{g['id']}.png"; hoja.save(out)
        print(out)
    nav.close()
