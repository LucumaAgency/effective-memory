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
