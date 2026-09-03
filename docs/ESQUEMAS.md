# Esquemas de datos

Regla de oro: **todos los tiempos van en segundos y en coordenadas del video ORIGINAL**,
nunca del render. Si se cortan silencios, los tiempos no se reescriben: se traducen al
render usando la tabla `conservar` de `cortes.json`. Sin esta regla, subtítulos y
comentarios se desincronizan en cuanto hay una segunda versión.

## meta.json
```json
{
  "slug": "2026-09-explainer-01",
  "titulo": "Explainer 01",
  "videoPath": "C:\\videos\\explainer-01.mp4",
  "creado": "2026-09-02T18:00:00.000Z",
  "duracion": 302.4, "bytes": 418000000,
  "ancho": 1080, "alto": 1920, "fps": 30, "tieneAudio": true
}
```
`videoPath` es local: solo sirve en el PC que generó el proyecto.

## transcript.json
```json
{ "idioma": "es", "modelo": "medium", "device": "cuda", "duracion": 302.4,
  "segmentos": [
    { "id": 0, "in": 0.42, "out": 4.10, "texto": "Hoy te voy a contar…",
      "palabras": [ { "p": "Hoy", "in": 0.42, "out": 0.61 } ] } ] }
```

## silencios.json
```json
{ "umbralDb": -32, "duracionMin": 0.35,
  "tramos": [ { "in": 73.80, "out": 76.12, "dur": 2.32 } ] }
```

## comentarios.json  (lo escribes tú desde la UI)
```json
{ "slug": "…", "items": [
  { "id": "c3", "t": 74.2, "tEnd": 79.0, "tipo": "corte",
    "texto": "aquí sale mucho 'este', límpialo",
    "estado": "abierto", "creado": "…" } ] }
```
`tipo`: `corte` · `subtitulo` · `grafico` · `nota`. Es lo que me dice qué herramienta usar
sin tener que deducirlo del texto. `estado`: `abierto` · `resuelto`.

## entregas/vN/cortes.json  (lo escribo yo)
```json
{ "version": "v2", "base": "original", "crossfade": 0.06,
  "conservar": [
    { "in": 0.0,   "out": 73.8,  "razon": "intro" },
    { "in": 76.1,  "out": 240.5, "razon": "corte de muletilla, comentario c3" } ] }
```
Cada segmento lleva `razon` para que corrijas el criterio, no el resultado.

## entregas/vN/nota.json
```json
{ "resumen": "Corté 14s de muletillas y ajusté 3 subtítulos.",
  "atiende": ["c1","c3","c7"],
  "dudas": ["en 2:41 no sé si la pausa es intencional"] }
```

## Frames
- `frames/m0000.jpg` … muestreo cada `FRAME_CADA` segundos (índice en `frames.json`).
- `frames/t134_50.jpg` … frame exacto pedido bajo demanda vía `GET /api/proyectos/:slug/frame?t=134.5`.

## entregas/vN/clips.json  (lo escribo yo)

Plan de clips verticales. Los tiempos van en coordenadas del **original**;
la app los rebasa sola al renderizar cada clip.

```json
{
  "formato": { "ancho": 1080, "alto": 1920, "disposicion": "apilado" },
  "fuente": {
    "contenido": { "y": 178, "alto": 362 },
    "personas": [
      { "nombre": "Cynthia Seinfeld", "x": 105, "ancho": 407 },
      { "nombre": "Fernando Velarde", "x": 736, "ancho": 407 }
    ]
  },
  "estilo": { "tamano": 60, "maxLinea": 26, "margenV": 150 },
  "correcciones": [["Talero", "Tablero"]],
  "clips": [
    { "id": "c01", "titulo": "Frank Gehry en el Perú",
      "in": 405.2, "out": 430.0,
      "gancho": "Frank Gehry en el Perú hubiera sido miserable",
      "razon": "nombre reconocible + afirmación tajante en los primeros 2 segundos" }
  ]
}
```

- `contenido` recorta el banner superior y la barra inferior del video fuente.
- `personas[].x` y `.ancho` son el recorte horizontal de cada cara, en píxeles del original.
- `disposicion`: `apilado` (dos cabezas, una encima de otra) o `recorte` (una sola persona
  a pantalla completa, eligiendo cuál con `"persona": 0|1` en el clip).
- `correcciones` son pares `[patrón, reemplazo]` que se aplican al texto del subtítulo.

## correcciones.json  (raíz del proyecto)

Nombres propios y términos que el reconocimiento de voz no puede acertar. Se escriben una
vez y valen para todos los subtítulos que se generen después, sin repetirlos en cada entrega.

```json
{ "reemplazos": [
    ["Talero", "Tablero"],
    ["Demás Consultoría", "Ve-Más Consultoría"]
] }
```

Cada par es `[patrón, reemplazo]`; el patrón es una expresión regular de JavaScript.
La transcripción original **no se toca**: es la salida cruda de Whisper y sirve de referencia.

## entregas/vN/cortes.json  (lo escribo yo)

Plan de corte no destructivo. El original no se toca; el resultado es un MP4 aparte.

```json
{
  "version": "v4", "base": "original",
  "crossfade": 0.03,
  "subtitulos": true,
  "estilo": { "tamano": 40, "margenV": 54 },
  "conservar": [
    { "in": 0.0,  "out": 73.8,  "razon": "intro" },
    { "in": 76.1, "out": 240.5, "razon": "corte de muletilla en 74s" }
  ]
}
```

- `conservar` lista lo que **se queda**, no lo que se quita: así el resultado es explícito
  y cada segmento puede llevar su `razon`.
- `crossfade` son los segundos de fundido de audio en cada empalme, para que el corte no
  suene a click. 0.03 es suficiente; por encima de 0.2 se ignora.
- `subtitulos: true` genera el `.ass` del video completo y **reubica los cues** en la línea
  de tiempo del resultado usando la tabla de `conservar`. Un cue que cae entero en un tramo
  eliminado se descarta; uno que queda partido se recorta al final de su tramo.

Al aplicarlo se escribe `renders/<proyecto>/cortes/<entrega>.mapa.json` con el desplazamiento
de cada tramo. Ese archivo es el que traduce cualquier tiempo del original al del render.

## Recalcular silencios

`POST /api/proyectos/:slug/silencios` con `{ "umbralDb": -28, "duracionMin": 0.4 }` vuelve a
correr `silencedetect` y reescribe `silencios.json`, sin repetir la transcripción. Desde la UI
está en el panel *Silencios detectados*. Subir el umbral (de -32 a -25) detecta más pausas,
porque el ruido de sala rara vez baja de -32 dB.

## entregas/vN/graficos.json + entregas/vN/graficos/*.html

Motion graphics. El HTML vive junto a su entrega, no en el repo de la app: la identidad
cambia según el proyecto, así que cada gráfico se escribe a medida. Cuando un patrón se
repita lo bastante, ese sí se convierte en plantilla reutilizable.

```json
{ "graficos": [
  { "id": "g01", "clip": "c01", "archivo": "cita.html",
    "in": 405.4, "out": 411.5,
    "ancho": 1080, "alto": 1920, "x": 0, "y": 0,
    "datos": { "texto": "Frank Gehry en el Perú\nhubiera sido miserable" } }
] }
```

`in` y `out` van en coordenadas del original, como todo lo demás; el motor calcula solo
dónde cae dentro del clip.

### Cómo se escribe el HTML

Los datos llegan en `window.DATOS` antes de que corra nada de la página.

**Todo lo animado tiene que ser una animación CSS o de la Web Animations API.** El motor no
graba en tiempo real: fija el reloj de cada animación a un instante exacto y captura. Por eso
`setTimeout` y `requestAnimationFrame` **no funcionan**. Si necesitas algo que CSS no cubre,
expón `window.dibujar(t)` y el motor la llama con el segundo actual antes de cada captura.

El fondo debe ser transparente (`background: transparent`): la captura usa `omitBackground`,
y de ahí sale el canal alfa.

### El pipeline

```
HTML  →  Chrome headless, fotograma a fotograma  →  PNG con alfa  →  WebM (VP9, yuva420p)  →  overlay
```

Se captura fijando `animation.currentTime` en vez de grabar en tiempo real, así el resultado
es idéntico en cualquier máquina y reproducible entre iteraciones. El WebM se cachea y solo
se regenera si el HTML cambió, así que recomponer un clip es instantáneo.

`GET /api/proyectos/:slug/graficos/preview?entrega=v5&id=g01&t=0.8` devuelve un PNG con el
gráfico sobre un frame del clip, en un par de segundos. Es para iterar sin renderizar.

### Navegador

No se instala ninguno: se busca Chrome y, si no está, **Edge**, que viene en todo Windows.
Se puede forzar con `NAVEGADOR=` en el `.env`.
