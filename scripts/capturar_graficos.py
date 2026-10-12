#!/usr/bin/env python3
"""Captura los gráficos HTML de una entrega como secuencias PNG con alfa (y WebM si hay ffmpeg).

    python3 scripts/capturar_graficos.py <carpeta-proyecto> <entrega> [ids...] [--fps 30]
        [--salida dir] [--webm] [--plantillas carpeta]

Mismo motor que server/graficos.js (reloj de animaciones fijado por fotograma), pero con
Playwright, para correr en el servidor. Para no capturar miles de fotogramas iguales, solo se
captura lo que se mueve: la entrada (hasta que terminan las animaciones que empiezan al
principio) y la salida (las que empiezan al final); el medio es un solo PNG de "espera".

Deja en <salida>/<id>/:
    entrada/f00000.png...    secuencia de entrada
    espera.png               fotograma fijo del tramo quieto
    salida/f00000.png...     secuencia de salida (si hay animación al final)
    tramos.json              { entrada: s, espera: s, salida: s, fps }
Con --webm además <id>.webm (VP9 con alfa) con la duración completa, para la PC o para FilmCraft.
"""
import json, os, argparse, pathlib, shutil, subprocess
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('proyecto'); ap.add_argument('entrega'); ap.add_argument('ids', nargs='*')
ap.add_argument('--fps', type=float, default=30); ap.add_argument('--salida'); ap.add_argument('--webm', action='store_true')
ap.add_argument('--plantillas', default=str(pathlib.Path(__file__).resolve().parent.parent / 'plantillas'))
a = ap.parse_args()

P = pathlib.Path(a.proyecto)
plan = json.load(open(P / 'entregas' / a.entrega / 'clips.json'))
gj = json.load(open(P / 'entregas' / a.entrega / 'graficos.json'))
salida = pathlib.Path(a.salida or (P / 'entregas' / a.entrega / 'filmcraft' / 'graficos'))
W, H = plan['formato'].get('ancho', 1080), plan['formato'].get('alto', 1920)


def ruta_html(g):
    for base in (P / 'entregas' / a.entrega / 'graficos', pathlib.Path(a.plantillas)):
        if (base / g['archivo']).exists(): return (base / g['archivo']).resolve()
    raise SystemExit(f"no encuentro {g['archivo']}")


def ffmpeg():
    for c in (shutil.which('ffmpeg'),):
        if c: return c
    try:
        import imageio_ffmpeg; return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception: return None


JS_TIEMPOS = '''() => document.getAnimations().map(an => {
  const t = an.effect?.getTiming?.() || {}
  const dur = typeof t.duration === 'number' ? t.duration : 0
  const iter = t.iterations === Infinity ? 1e9 : (t.iterations || 1)
  return { ini: (t.delay || 0), fin: (t.delay || 0) + dur * iter + (t.endDelay || 0) }
})'''

with sync_playwright() as pw:
    nav = pw.chromium.launch(args=['--no-sandbox', '--force-color-profile=srgb'])
    for g in gj['graficos']:
        if a.ids and g['id'] not in a.ids: continue
        if not str(g.get('archivo', '')).endswith('.html'): continue
        # pan.html sobre una foto: FilmCraft lo reproduce nativamente (V2 con escala y paneo)
        if g.get('archivo') == 'pan.html' and (g.get('datos') or {}).get('archivo'): continue
        dur = g['out'] - g['in']
        datos = dict(g.get('datos', {})); datos.setdefault('duracion', round(dur, 3))
        gw, gh = g.get('ancho', W), g.get('alto', H)
        pg = nav.new_page(viewport={'width': gw, 'height': gh}, device_scale_factor=1)
        pg.add_init_script(f'window.DATOS = {json.dumps(datos, ensure_ascii=False)}')
        pg.goto('file://' + str(ruta_html(g)), wait_until='networkidle')
        pg.evaluate('document.fonts && document.fonts.ready')
        tiempos = pg.evaluate(JS_TIEMPOS)
        # entrada: animaciones que empiezan antes de la mitad; salida: las que empiezan después
        mitad = dur * 1000 / 2
        fin_entrada = max([t['fin'] for t in tiempos if t['ini'] < mitad] + [0]) / 1000
        ini_salida = min([t['ini'] for t in tiempos if t['ini'] >= mitad] + [dur * 1000]) / 1000
        fin_entrada = min(fin_entrada + 2 / a.fps, dur)
        ini_salida = max(ini_salida - 1 / a.fps, fin_entrada)
        d = salida / g['id']
        if d.exists(): shutil.rmtree(d)
        (d / 'entrada').mkdir(parents=True); (d / 'salida').mkdir()

        def fijar(t):
            pg.evaluate('(ms) => { document.getAnimations().forEach(an => { an.pause(); an.currentTime = ms }) }', t * 1000)

        n_ent = max(1, round(fin_entrada * a.fps))
        for i in range(n_ent):
            fijar(i / a.fps); pg.screenshot(path=str(d / 'entrada' / f'f{i:05d}.png'), omit_background=True)
        fijar(fin_entrada); pg.screenshot(path=str(d / 'espera.png'), omit_background=True)
        n_sal = max(0, round((dur - ini_salida) * a.fps))
        for i in range(n_sal):
            fijar(ini_salida + i / a.fps); pg.screenshot(path=str(d / 'salida' / f'f{i:05d}.png'), omit_background=True)
        tramos = dict(entrada=n_ent / a.fps, espera=max(0, ini_salida - n_ent / a.fps), salida=n_sal / a.fps,
                      fps=a.fps, ancho=gw, alto=gh, duracion=dur)
        json.dump(tramos, open(d / 'tramos.json', 'w'), indent=2)
        print(f"{g['id']}: entrada {n_ent} f, espera {tramos['espera']:.2f} s, salida {n_sal} f")
        pg.close()

        if a.webm:
            ff = ffmpeg()
            if not ff: print('  sin ffmpeg: no se genera el webm'); continue
            # concatenar: entrada + espera (clonada) + salida, a fps constante
            lista = d / 'lista.txt'
            with open(lista, 'w') as f:
                for i in range(n_ent): f.write(f"file 'entrada/f{i:05d}.png'\nduration {1 / a.fps}\n")
                if tramos['espera'] > 0: f.write(f"file 'espera.png'\nduration {tramos['espera']}\n")
                for i in range(n_sal): f.write(f"file 'salida/f{i:05d}.png'\nduration {1 / a.fps}\n")
                f.write(f"file '{'salida/f%05d.png' % (n_sal - 1) if n_sal else 'espera.png'}'\n")
            subprocess.run([ff, '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lista.resolve()),
                            '-vsync', 'cfr', '-r', str(a.fps), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
                            '-auto-alt-ref', '0', '-b:v', '0', '-crf', '28', str((salida / f"{g['id']}.webm").resolve())], check=True, cwd=d)
            print(f"  {g['id']}.webm")
    nav.close()
