# Bitácora del proyecto

Cómo llegamos a lo que hay, qué decidimos y por qué, y qué se rompió por el camino.
Está escrito para que dentro de seis meses cualquiera de los dos entienda las decisiones
sin tener que releer la conversación.

Fecha de arranque: **2 de septiembre de 2026**. Todo lo de abajo pasó en un día.

---

## 1. El problema original

El pedido inicial fue: *"una webapp para que me ayudes a editar videos, cosas simples como
poner subtítulos, añadir motion graphics y cortar espacios sin sonido"*, con **un espacio
público con URL por proyecto** donde Claude pudiera entrar a ver el video, con timeline y
comentarios por parte del video.

### La objeción que cambió el diseño

Claude no puede ver un video. Una URL con un reproductor es inútil para él: no hay
reproducción, no hay ojos. Si la app se hubiera construido tal como se pidió, habría
quedado bonita e inservible.

Lo que sí puede leer:

| Artefacto | Peso (video de 5 min) | Para qué sirve |
|---|---|---|
| Transcripción con timestamps por palabra | ~30 KB | saber qué se dice y cuándo |
| Mapa de silencios | ~2 KB | saber dónde hay huecos |
| Frames de muestra | ~3 MB | *ver* momentos puntuales |
| Comentarios anclados a segundos | ~5 KB | saber qué pide el usuario |

De ahí sale la idea central de todo el proyecto: **la app no le enseña el video a Claude,
le enseña una representación del video**. El binario nunca hace falta.

---

## 2. Las decisiones estructurales

### 2.1 Local, no en un servidor

La primera idea fue montarlo en Plesk. Al verificar el entorno resultó que la máquina donde
corre Claude **no es** el Plesk (2 cores, 3 GB, sin ffmpeg), así que "misma máquina" nunca
fue una opción. La alternativa que propuso Carlos —correr todo en su PC y sincronizar por
GitHub— resultó mejor que la original:

- **Cero uploads.** El MP4 de 500 MB no se mueve. El seek en la timeline es instantáneo
  porque el video se sirve desde disco local con `Range`.
- **CPU y GPU reales.** Una RTX 3060 transcribe 5 minutos en segundos; un VPS compartido
  tardaría minutos.
- **Git da el versionado gratis.** No hubo que inventar un sistema de versiones: cada plan
  de corte y cada `.ass` queda en el historial.

Se perdió la URL pública, pero al analizarlo **el único humano que iba a entrar era Carlos**.
La URL era un rodeo para hacerle llegar el contexto a Claude, y Git lo hace mejor.

### 2.2 Dos repos, y por qué uno es privado

| Repo | Qué lleva | Visibilidad |
|---|---|---|
| `effective-memory` | el código de la plataforma | público: no contiene contenido de nadie |
| `video-review-proyectos` | transcripciones, comentarios, entregas | **privado** |

Carlos propuso público para los dos "porque tengo GitHub gratis". Ahí hubo una corrección de
hecho: GitHub free da **repos privados ilimitados** desde 2019, y un repo público expondría
las transcripciones completas de videos aún no publicados, indexables por Google. El costo de
privado es cero.

El `.gitignore` del repo de datos bloquea `*.mp4`, `*.mov`, `*.wav` y la carpeta `renders/`.
Un arrastre accidental no puede meter 500 MB al repo.

### 2.3 Todo en coordenadas del video original

**La regla que sostiene el resto del sistema.** Cada tiempo —subtítulos, comentarios,
cortes, clips— se guarda en segundos del video original, nunca del render.

Se decidió antes de escribir la primera línea de la fase 1, porque el problema aparece
después y para entonces es carísimo: si cortas silencios y reescribes los timestamps, todo lo
que existía se desincroniza. En cambio, con la tabla `conservar` de `cortes.json` un tiempo
del original se traduce a cualquier render.

La consecuencia visible: cuando comentas sobre un clip que empieza en 6:45, la app guarda
`405.2 + lo que marque el reproductor` y te muestra el minuto relativo al clip. Por dentro
hay una sola línea de tiempo; por fuera ves la que esperas.

### 2.4 Entregas declarativas, renders no destructivos

Claude no toca el binario del video. Produce **instrucciones**: un `.ass`, un `clips.json`,
un `cortes.json`. ffmpeg las aplica en la máquina de Carlos.

Esto hace que iterar sea barato (se discute sobre un archivo de 4 KB, no sobre un MP4) y que
nada sea irreversible: el original no se modifica y cada render es una versión aparte.

---

## 3. Cómo funciona, en una página

```
[PC Windows]                                  [GitHub]              [Claude]
 app local :5180
   │
   ├─ ingest ─────────────────────────────────────────────────────────────────
   │    ffprobe        → duración, fps, resolución
   │    silencedetect  → silencios.json
   │    frames         → uno cada 10 s + los que se pidan sueltos
   │    faster-whisper → transcript.json (GPU, timestamps por palabra)
   │
   ├─ dashboard ──────────────────────────────────────────────────────────────
   │    player con Range (seek instantáneo sobre el archivo local)
   │    timeline: silencios en rojo, voz en azul, marcas de comentario
   │    comentarios anclados al segundo y tipados
   │
   ├─ "Pedir revisión" → commit + push ──────► repo datos ──────► git pull
   │                                                              lee todo el
   │                                                              contexto
   │                                                                   │
   │                                           repo datos ◄─────────── commit
   ◄─ "Traer entrega" (fetch + merge) ────────────┘                 entregas/vN/
   │
   ├─ "Ver preview"     → ffmpeg quema el .ass sobre un tramo
   └─ "Renderizar clip" → recorte + apilado + subtítulos → 1080x1920
```

### El reparto de trabajo

**Claude hace el juicio editorial**: qué frase se sostiene sola, dónde cierra la idea, qué
nombre propio corrigió mal el ASR, qué corte tiene sentido. **ffmpeg hace lo mecánico.**
Ninguno de los dos hace el trabajo del otro.

---

## 4. Cronología de features

### Fase 1 · El circuito completo
`4f9090f`

Ingest, dashboard, comentarios, push y pull. La decisión fue construir **el bucle antes que
las funciones**: sin un ida y vuelta sin fricción, las funciones no sirven de nada.

### Subtítulos con caja blanca
Primer comentario real de Carlos: *"añadir subtítulos en el primer minuto, que tengan un
fondo blanco cuadrado, para que no se mezclen con el fondo"*.

Se entregó un `.ass` con `BorderStyle: 3`, que dibuja una caja opaca en vez de un contorno.
Texto en `#191A1A` en lugar de negro puro, que sobre blanco cansa menos.

Se corrigieron dos cosas que el reconocimiento de voz no podía saber: **"Talero" → "Tablero
Inmobiliario"** (lo confirma el propio audio más adelante) y **"Demás" → "Ve-Más
Consultoría"**, que es cliente de la agencia.

### Preview desde la UI
`77c7d27`

La primera entrega venía con un comando de ffmpeg para que Carlos lo corriera a mano. Su
respuesta fue: *"no entiendo, ¿en dónde pongo el comando? deberíamos mejorar eso en el UI"*.

Tenía razón: **si hay que explicar un comando, la herramienta no está terminada.** Se añadió
el botón "Ver preview" con barra de progreso real (`ffmpeg -progress`) y un selector para
alternar entre el original y cada preview.

Detalle de implementación: ffmpeg corre con `cwd` en la carpeta de la entrega y usa el nombre
del `.ass` sin ruta. Escapar rutas de Windows dentro de un filtro de ffmpeg (dos puntos,
barras invertidas) es un infierno; cambiar el directorio de trabajo lo evita entero.

### Clips verticales
`3df76e4`

Pedido: clips de 20-30 segundos para TikTok, elegidos por Claude leyendo la transcripción.

Antes de cortar nada se miraron los frames, y el layout cambió el enfoque: es una **pantalla
partida**, Cynthia a la izquierda y Fernando a la derecha, con banner morado arriba y barra
verde de VeMás abajo. Recortar al centro habría dejado media cara de cada uno.

La solución fue apilarlos en vertical. Se midió sobre los frames dónde está cada cara
(Cynthia en x=308, Fernando en x=939 del original de 1280x720) y se recortan 407 px de ancho
alrededor de cada una, dejando fuera el banner y la barra.

### Comentarios por clip
`9aeaae7`

Pedido de Carlos, junto con quitar "TikTok" del nombre del panel. Cada clip tiene su caja de
comentarios; el tiempo se guarda en coordenadas del original, así que esos comentarios
también aparecen en la timeline grande con su marca de color.

### correcciones.json
`a754b87`

Los nombres propios se estaban repitiendo en cada entrega. Era cuestión de tiempo que se
olvidara uno. Ahora van una vez en la raíz del proyecto y valen para todo lo que se genere
después. La transcripción cruda **no se toca**: queda como referencia de lo que dijo el modelo.

### Clips de hasta 60 segundos
`6435114`

Carlos señaló que Shorts y Reels ya no tienen el límite corto de antes. El cambio no fue
"alargar los clips": fue **cambiar el criterio de corte**. El límite dejó de ser la duración
y pasó a ser dónde cierra la idea.

Eso hizo publicable material que antes había que descartar. El ejemplo claro es el clip sobre
el parámetro urbano: explicar retiro, densidad, pisos y ventilación para aterrizar en
"terminan creando literalmente una cajita" no cabe en 25 segundos. En 37 sí, y es el que
mejor explica el tema del video.

También se fusionaron dos clips sueltos de la v2 en un solo argumento completo, y uno se dejó
deliberadamente en 28 segundos: es una anécdota y estirarla la diluye. **El límite no es una
cuota que haya que llenar.**

### Clips en rejilla
Con nueve clips el panel lateral obligaba a scrollear demasiado. La sección pasó a ocupar el
ancho completo debajo de la transcripción, en una rejilla que se adapta al ancho de la
ventana, y **muestra una sola entrega a la vez** con un selector. Cada tarjeta lleva su propio
estado (`sin renderizar` / `renderizando` / tamaño en MB / `falló`), así que ya no hay que
adivinar si algo pasó. El *por qué* de cada corte quedó plegado tras un enlace, que estorbaba
más de lo que ayudaba una vez leído.

---

## 5. Lo que se rompió, y por qué

Vale la pena guardarlo: casi todo fue entorno de Windows, no lógica.

| Síntoma | Causa real |
|---|---|
| `npm` no se reconoce | Node instalado pero fuera del PATH |
| `npm.ps1 ... la ejecución de scripts está deshabilitada` | `ExecutionPolicy` de PowerShell. Se resolvió con `RemoteSigned` para el usuario |
| ffmpeg "no está" | Sí estaba: winget lo dejó en `%LOCALAPPDATA%\Microsoft\WinGet\Packages\...` sin tocar el PATH |
| `ffprobe ... Permission denied` | Se pegó la ruta de una **carpeta**, no del archivo. `existsSync` devuelve `true` para directorios y la validación la dejó pasar |
| El server se caía con `ERR_HTTP_HEADERS_SENT` | El manejador de errores respondía cuando las cabeceras ya habían salido |
| `Library cublas64_12.dll is not found` | En Windows las DLL de `nvidia-cublas-cu12` quedan en `site-packages` y **no** en el PATH, así que ctranslate2 no las encuentra aunque estén instaladas |
| Renderizar un clip nuevo "no hacía nada" | Se renderizaba, pero la UI buscaba el archivo por su nombre viejo (sin el prefijo de entrega) y nunca lo mostraba. Pasa si el server no se reinicia tras actualizar |
| `Cannot fast-forward to multiple branches` | `git pull` decide qué fusionar leyendo `branch.<rama>.merge`. Si esa config lista más de una referencia, **ningún argumento de línea de comandos lo salva**: hubo que pasar a `fetch` + `merge FETCH_HEAD` |

Arreglos preventivos que salieron de ahí: `npm run doctor` verifica el entorno antes de que
se pierda tiempo, `transcribir.py` registra las DLL de CUDA con `os.add_dll_directory` y cae
a CPU si la GPU falla, y los errores llegan a la UI como la línea útil del traceback en vez
del volcado entero.

---

## 6. Estado y qué sigue

**Funcionando:** ingest con GPU, dashboard con timeline y comentarios, ida y vuelta por Git,
preview de subtítulos quemados, clips verticales con comentarios propios.

**Pendiente:**

- **Cortar silencios del video completo** (`cortes.json` + `conservar`). Es la razón por la
  que existe la regla de coordenadas del original, pero todavía no se ha usado. En los 27
  minutos del primer video hay 95 tramos de silencio detectados.
- **Motion graphics.** El diseño acordado es HTML/CSS animado → Puppeteer → PNG con alpha →
  composición con ffmpeg. Se eligió sobre overlays de ffmpeg puro porque la ventaja real es
  que Claude puede *diseñar* los gráficos, no solo posicionarlos.
- **Avisar de comentarios sin subir.** Ya pasó una vez: se comentó y no se pulsó "Pedir
  revisión", así que el comentario nunca llegó. Es fricción evitable.

**Preguntas abiertas:**

- En 0:50 se transcribió "Un pulitzerri". Carlos indicó que dice **"publicherry"** y así
  quedó. Por contexto (él la elogia, ella responde eso, él dice "por supuesto que sí") podría
  ser *"un publirreportaje"*, en broma. Se cambia en una línea de `correcciones.json` si al
  verlo en pantalla resulta ser eso.
- El formato apilado muestra a los dos todo el tiempo. Está soportado mostrar solo a quien
  habla (`"disposicion": "recorte"`), pendiente de decidir.
- La fuente de los subtítulos es Montserrat SemiBold. Si no está instalada en Windows,
  libass cae a otra y se ve distinto.
