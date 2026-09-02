# Arquitectura

## Por qué así

El video de 5 minutos pesa cientos de MB y **nunca sale del PC**. Lo que viaja a GitHub es su
representación: transcripción, silencios, frames de muestra y comentarios. Unos pocos MB por
proyecto. Claude no reproduce el video, razona sobre esos artefactos y sobre frames puntuales.

Git no es solo el transporte: es también el versionado. Cada plan de corte y cada `.ass` queda
en el historial, así que "vuelve al corte de la v1 pero con los subtítulos de la v2" es trivial.

## Dos repos

| Repo | Qué lleva | Visibilidad |
|---|---|---|
| `effective-memory` | el código de la plataforma | público (no lleva contenido) |
| `video-review-proyectos` | datos de cada proyecto | privado (transcripciones sin publicar) |

## Ciclo

```
[PC Windows]                              [GitHub]            [Claude]
 app local :5180
   ├ ingest: ffprobe · silencedetect · frames · faster-whisper (GPU)
   ├ dashboard: player + timeline + comentarios anclados a segundos
   │
   ├─ "Pedir revisión" → commit + push ───► repo datos ──────► git pull
   │                                                           lee transcript,
   │                                                           silencios, frames,
   │                                                           comentarios
   │                                                              │
   │                                        repo datos ◄────────── commit + push
   ◄─ "Traer entrega" (git pull) ─────────────┘                  entregas/vN/
   │
   └ aplicar cortes con ffmpeg → v2.mp4 local        (fase 2)
```

## Nunca destructivo

El original no se toca. Cada render es `v1.mp4`, `v2.mp4`… y cada uno guarda el JSON que lo
produjo. Sin esto, iterar tres veces sería irreversible.

## Fases

- **1 · circuito** (hecho): ingest, dashboard, comentarios, push/pull.
- **2 · cortes**: aplicar `cortes.json` con ffmpeg, comparar versiones en el player.
- **3 · subtítulos**: `.ass` estilizado, preview en el player, quemado al render.
- **4 · motion graphics**: overlays HTML/CSS grabados con Puppeteer a PNG con alpha, compuestos con ffmpeg.

## Endpoints

| Ruta | Uso |
|---|---|
| `GET /api/salud` | estado del repo de datos |
| `GET/POST /api/proyectos` | listar / crear (crear dispara el ingest) |
| `GET /api/proyectos/:slug` | todo el contexto del proyecto |
| `GET /api/proyectos/:slug/video` | streaming con `Range` (seek instantáneo) |
| `GET /api/proyectos/:slug/frame?t=134.5` | frame exacto bajo demanda |
| `POST/PATCH/DELETE …/comentarios` | CRUD de comentarios |
| `POST …/pedir-revision` | commit + push del repo de datos |
| `POST /api/traer` | git pull |
