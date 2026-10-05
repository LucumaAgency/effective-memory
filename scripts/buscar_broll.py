#!/usr/bin/env python3
"""
Busca b-roll en Pixabay y lo deja listo para una entrega.

  python scripts/buscar_broll.py --destino <carpeta graficos de la entrega> \
      --plano 01-ciudad "lima city aerial" --plano 02-llaves "house keys hand" ...

Por cada plano baja la mejor foto (vertical primero, luego cualquiera), la guarda como
<nombre>.jpg y apunta fuente y autor en <destino>/broll-fuentes.json. Con --candidatas N
guarda ademas N miniaturas por plano en <destino>/_candidatas/ para elegir a ojo.

La clave va en la variable PIXABAY_API_KEY o en un .env (PIXABAY_API_KEY=...). Nunca en el repo.
Licencia Pixabay: uso comercial sin atribucion; se guarda el credito igual, por cortesia.
"""
import argparse, json, os, sys, urllib.parse, urllib.request

API = 'https://pixabay.com/api/'
# Pixabay (API y CDN) devuelve 403 al User-Agent por defecto de urllib.
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) video-review/1.0'}

def clave():
    k = os.environ.get('PIXABAY_API_KEY')
    if k: return k
    for f in (os.environ.get('PIXABAY_ENV', ''), os.path.expanduser('~/.d3k-wp.env'), '.env'):
        if f and os.path.exists(f):
            for linea in open(f, encoding='utf-8'):
                if linea.startswith('PIXABAY_API_KEY='):
                    return linea.split('=', 1)[1].strip().strip('"')
    sys.exit('falta PIXABAY_API_KEY')

def buscar(k, q, orientacion='vertical', n=10, tipo='photo'):
    qs = urllib.parse.urlencode({'key': k, 'q': q, 'image_type': tipo, 'orientation': orientacion,
                                 'per_page': n, 'min_width': 1080, 'safesearch': 'true', 'order': 'popular'})
    with urllib.request.urlopen(urllib.request.Request(f'{API}?{qs}', headers=UA), timeout=30) as r:
        return json.load(r).get('hits', [])

def bajar(url, destino):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r, open(destino, 'wb') as f:
        f.write(r.read())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--destino', required=True)
    ap.add_argument('--plano', nargs=2, action='append', metavar=('NOMBRE', 'CONSULTA'), required=True)
    ap.add_argument('--candidatas', type=int, default=0)
    ap.add_argument('--elegir', default='', help='nombre=indice,... para escoger otra candidata')
    a = ap.parse_args()
    k = clave()
    os.makedirs(a.destino, exist_ok=True)
    elegidos = dict(p.split('=') for p in a.elegir.split(',') if '=' in p)
    fuentes_f = os.path.join(a.destino, 'broll-fuentes.json')
    fuentes = json.load(open(fuentes_f)) if os.path.exists(fuentes_f) else {}
    for nombre, consulta in a.plano:
        hits = buscar(k, consulta) or buscar(k, consulta, 'all')
        if not hits:
            print(f'{nombre}: sin resultados para "{consulta}"'); continue
        i = int(elegidos.get(nombre, 0))
        h = hits[min(i, len(hits) - 1)]
        salida = os.path.join(a.destino, f'{nombre}.jpg')
        bajar(h.get('largeImageURL') or h['webformatURL'], salida)
        fuentes[nombre] = {'consulta': consulta, 'indice': i, 'id': h['id'], 'url': h['pageURL'],
                           'autor': h['user'], 'ancho': h['imageWidth'], 'alto': h['imageHeight'], 'tags': h['tags']}
        print(f'{nombre}: #{i} {h["imageWidth"]}x{h["imageHeight"]} · {h["tags"]} · {h["pageURL"]}')
        if a.candidatas:
            cd = os.path.join(a.destino, '_candidatas'); os.makedirs(cd, exist_ok=True)
            for j, c in enumerate(hits[:a.candidatas]):
                bajar(c['previewURL'], os.path.join(cd, f'{nombre}-{j}.jpg'))
    json.dump(fuentes, open(fuentes_f, 'w'), ensure_ascii=False, indent=2)

if __name__ == '__main__':
    main()
