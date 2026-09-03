# video-review

Plataforma local para revisar video con ayuda de Claude: subtítulos, cortes de silencio y
motion graphics. Corre en tu PC, el video nunca se sube a ningún lado.

> Datos de proyectos: repo privado aparte, [`video-review-proyectos`](https://github.com/LucumaAgency/video-review-proyectos).
>
> - [`docs/BITACORA.md`](docs/BITACORA.md) — **empieza por aquí**: por qué está hecho así, qué se decidió y qué se rompió
> - [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — el diseño y los endpoints
> - [`docs/ESQUEMAS.md`](docs/ESQUEMAS.md) — el formato de cada archivo

## Instalación en Windows

```powershell
winget install Gyan.FFmpeg
winget install OpenJS.NodeJS.LTS
pip install faster-whisper
pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"   # solo si tienes GPU NVIDIA

git clone https://github.com/LucumaAgency/effective-memory.git video-review
git clone https://github.com/LucumaAgency/video-review-proyectos.git
cd video-review
copy .env.example .env      # ajusta DATA_REPO a la ruta del repo de datos
npm install
npm run doctor              # verifica ffmpeg, python, faster-whisper, GPU y repo
```

Cierra y reabre la terminal después del `winget` para que el PATH tome ffmpeg.

### GPU

Con una NVIDIA (una 3060 sirve de sobra) `faster-whisper` usa CUDA solo: `npm run doctor`
te dice si la detectó. Un video de 5 minutos con el modelo `medium` transcribe en ~20-30 s.
En CPU son varios minutos, pero funciona igual.

CUDA necesita además cuBLAS y cuDNN, que van en el `pip install` de arriba. En Windows esas
DLL no quedan en el PATH, así que `scripts/transcribir.py` registra sus carpetas al arrancar.
Si la GPU falla de todas formas, el script **reintenta solo en CPU** en vez de abortar el
ingest, y te lo dice en el log. Para forzar CPU y no esperar el reintento: `WHISPER_DEVICE=cpu`.

## Uso

```
iniciar.bat          (o: npm start)
```

Abre `http://localhost:5180`.

1. Pega la ruta local del video y crea el proyecto. Arranca el ingest: metadata, silencios,
   frames cada 10 s y transcripción con timestamps por palabra.
2. Mira el video en el dashboard. La timeline muestra los silencios en rojo y los tramos con
   voz en azul. Comenta en el segundo exacto y marca el tipo: `corte`, `subtítulo`, `gráfico` o `nota`.
3. **Pedir revisión** sube el contexto al repo de datos.
4. Claude lo lee, trabaja y devuelve una entrega en `entregas/vN/`.
5. **Traer entrega** hace el pull.
6. En el panel de Entregas, **Ver preview** quema los subtítulos sobre el tramo que elijas
   y lo deja reproducible en el mismo player. El selector de arriba alterna entre el
   original y cada preview.

Atajos: `espacio` play/pausa · `←/→` 2 s · `C` comentar en el segundo actual.

## Configuración (`.env`)

| Variable | Por defecto | Qué hace |
|---|---|---|
| `DATA_REPO` | — | ruta local del repo de datos |
| `PORT` | 5180 | puerto del dashboard |
| `WHISPER_MODEL` | medium | `small` si quieres más velocidad, `large-v3` más precisión |
| `WHISPER_DEVICE` | auto | `cuda` o `cpu` para forzar |
| `FRAME_CADA` | 10 | segundos entre frames del muestreo |
| `SILENCIO_DB` | -32 | umbral de silencio; sube a -26 si tu audio tiene ruido de fondo |
| `SILENCIO_MIN` | 0.35 | duración mínima para contar como silencio |

Las previews se guardan en `<DATA_REPO>/renders/<proyecto>/` y están fuera del control de
versiones: son binarios y se regeneran cuando haga falta.

## Motion graphics

Se pide comentando en un clip con tipo `gráfico`. Claude escribe el HTML animado y lo entrega
en `entregas/vN/graficos/`. La app lo captura fotograma a fotograma con Chrome (o Edge), lo
guarda como WebM con alfa y lo compone sobre el clip. El botón **vista previa** muestra el
gráfico sobre un frame real en un par de segundos, con una barra para recorrer la animación.

## Referencias de estilo

`/referencias.html` (enlace en la portada). Se le da la ruta de un video corto de otra persona
y la app mide lo objetivo (ritmo de corte, sonoridad, color, palabras por minuto) y extrae las
imágenes que Claude necesita mirar: hojas de contacto, fotogramas en cada cambio de plano y
recortes **sin escalar** de la zona del subtítulo, que es donde se ve la tipografía.

Claude escribe después un `estilo.json` con lo observado y unos valores propuestos, que se
copian a mano donde convenzan.

## Estado

- **Fase 1 · circuito completo** — listo: ingest, dashboard, comentarios, push/pull.
- **Fase 3 · subtítulos** — preview funcionando: quemado de `.ass`/`.srt` desde la UI.
- **Clips verticales** — funcionando: `clips.json` en una entrega genera cortes 1080x1920
  con subtítulos quemados y los tiempos rebasados a cada clip. Cada clip admite sus propios
  comentarios, que se guardan en coordenadas del original y aparecen también en la timeline.
- **Fase 2 · cortes** — funcionando: `cortes.json` genera el video recortado, con los
  subtítulos reubicados en la nueva línea de tiempo y un mapa de traducción de tiempos.
  El umbral de detección de silencios se puede recalcular desde la UI.

