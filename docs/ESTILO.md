# Referencias de estilo

Cómo se aprende el estilo de edición de otra persona y se replica. Escrito tras decidirlo en
conversación el 2 y 3 de septiembre de 2026.

---

## El problema

Claude no puede ver un video. Puede ver **imágenes**. Así que una referencia de estilo no se
"pasa", se **traduce**: se parte en lo que una máquina puede medir y en lo que hay que mirar.

Confundir las dos partes es el error clásico. Lo medible descrito a ojo sale impreciso
("cortes rápidos"); lo visual reducido a números pierde justo lo que define el estilo.

## Lo que se mide solo

Sale de ffmpeg sin que nadie mire nada, y define el estilo más de lo que parece:

| Medida | Cómo | Qué dice |
|---|---|---|
| Ritmo de corte | `select='gt(scene,0.28)'` | duración media de plano. 2 s y 6 s son estilos opuestos |
| Sonoridad | `ebur128` | LUFS y rango: delata música de fondo y a qué nivel está mezclada |
| Color | `signalstats` | saturación y brillo medios: saturado, apagado, cálido |
| Habla | transcripción propia | palabras por minuto |
| Formato | `ffprobe` | relación, fps, si es vertical |

## Lo que hay que mirar

La app extrae tres cosas distintas, y la distinción importa:

| Carpeta | Qué es | Para qué |
|---|---|---|
| `hojas/` | rejillas de 6×5 a 2 fotogramas por segundo | ritmo, encuadre, flujo general |
| `frames/` | fotograma entero en cada cambio de plano | gráficos, composición |
| `subtitulos/` | mitad inferior **sin escalar** | tipografía, contorno o caja, posición |

El tercero es el que suele olvidarse. **En miniatura no se distingue una grotesca con contorno
de una con caja**, y eso es exactamente lo que hay que replicar. Por eso ese recorte va a
resolución original aunque pese más.

Comprobado sobre un video de prueba con subtítulos quemados: del recorte se identifica sin
ambigüedad que la fuente es pesada, en mayúsculas, amarilla, con contorno negro, sin caja, y
centrada al 65% de la altura. De la hoja de contactos se lee la secuencia completa de cues.

## El resultado: `estilo.json`

```json
{ "medido":    { "planoMedio": 2.1, "lufs": -14.2, "saturacionMedia": 132.5 },
  "observado": { "subtitulos": "...", "graficos": "...", "encuadre": "..." },
  "aplicar":   { "subtitulos": { "maxLinea": 18, "tamano": 72 },
                 "clips": { "duracionObjetivo": 35 } } }
```

`medido` y `observado` son la lectura. `aplicar` es la decisión.

## Decisiones tomadas

- **Las referencias son de terceros**, no propias. Por eso viven por proyecto y no como perfil
  permanente de marca.
- **Dos o tres del mismo estilo**, no una. Con una sola las medidas son frágiles: un video
  puede tener cortes rápidos por casualidad. Con tres se puede además señalar en qué se
  contradicen entre sí, que suele ser lo más revelador.
- **Aplicación sugerida, nunca automática.** `aplicar` se copia a mano donde convenza. Que un
  archivo cambie el aspecto de todos los clips sin avisar es la clase de magia que luego cuesta
  depurar.
- **Vivien en `referencias/`, fuera de los proyectos**, porque describen un *cómo*, no un *qué*.
- **Se replica el estilo, no los recursos.** Logos, plantillas y música de la referencia no se
  reutilizan. El estilo no es de nadie; los archivos sí.

## Lo que no se puede prometer

- Detectar zooms y movimientos de cámara de forma fiable.
- Clavar una tipografía exacta si es de pago o propia. Se puede identificar la familia
  ("grotesca pesada tipo Montserrat"), no garantizar la fuente.
- Saber de dónde sacar b-roll. Se puede ver que lo hay, no reproducirlo.

---

## Cómo hacer que aprenda más rápido

Ordenado por cuánto acelera de verdad. **Ninguno está construido todavía.**

### La asimetría que hay que corregir

Hoy la referencia se analiza con lupa y **el propio resultado nunca se mira**. Solo llegan las
correcciones en texto. Eso es lo que hace lento el aprendizaje: se trabaja a ciegas sobre el
propio trabajo.

### 1. Ver la propia salida, en el mismo formato

Al renderizar un clip, generar **la misma hoja de contactos** que se le hace a la referencia.
Así se comparan dos rejillas equivalentes en vez de imaginar cómo quedó.

Lo más barato de construir y lo que más cambia.

### 2. Convertir lo observado en números

Detectar automáticamente la caja de texto sobre los frames y medir: altura en porcentaje,
centro horizontal, alto de fuente relativo al alto del video, color de relleno, contorno o caja.

La comparación deja de ser opinión:

```
                 referencia   salida
altura subtítulo     65%       88%     ← corregir
alto de fuente      4.5%      3.0%     ← corregir
plano medio         2.1s       61s     ← distinto a propósito
palabras por cue     3.2       6.1     ← corregir
```

Cerrar cuatro números es mucho más rápido que interpretar un párrafo.

### 3. Que las correcciones se acumulen

Una corrección dicha en un comentario se resuelve y desaparece, así que se puede repetir el
mismo error. El patrón ya está resuelto una vez con `correcciones.json` para los nombres
propios: un archivo de reglas de estilo hace lo mismo. Es memoria, y es lo que hace que la
segunda vuelta sea más rápida que la primera.

### 4. Variantes en vez de descripciones

Generar tres versiones del mismo clip con parámetros distintos y elegir una. Un clic enseña
más que un párrafo, porque elimina la traducción entre lo que se quiere decir y lo que se
entiende. Y cuesta tres segundos en vez de tres minutos.

Conviene **después** de tener un estilo base: generar variantes de todo antes de un punto de
partida es desperdiciar renders.

### Lo que no vale la pena

- **Decenas de referencias.** Con tres del mismo estilo las medidas ya son estables. Más
  videos no dan más señal, dan más ruido.
- **Detección automática de zoom y movimiento de cámara.** Poco fiable, mucho trabajo.
- **Métricas de rendimiento** (retención, vistas). Sería la señal más honesta de todas, pero
  depende de datos que no están aquí.

### Orden recomendado

**1 y 2 juntos**, que son el mismo mecanismo: cerrar el bucle sobre la propia salida y hacer
la comparación numérica. Con eso cada iteración se corrige sola, sin tener que explicar nada.
