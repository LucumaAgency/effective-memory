// Construye subtitulos .ass a partir de la transcripcion, opcionalmente
// rebasando los tiempos a un tramo (para clips).

const MAX_LINEA = 42
const MAX_CUE = 76
const MAX_DUR = 5.5

const hms = (t) => {
  const s = Math.max(0, t)
  const h = Math.floor(s / 3600)
  const m = Math.floor(s % 3600 / 60)
  return `${h}:${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`
}

/** Parte en dos lineas lo mas parejas posible sin pasar de MAX_LINEA. */
function dosLineas (texto, maxLinea = MAX_LINEA) {
  if (texto.length <= maxLinea) return texto
  const pal = texto.split(' ')
  let mejor = null, coste = Infinity
  for (let i = 1; i < pal.length; i++) {
    const a = pal.slice(0, i).join(' ')
    const b = pal.slice(i).join(' ')
    if (a.length > maxLinea || b.length > maxLinea) continue
    const c = Math.abs(a.length - b.length)
    if (c < coste) { mejor = [a, b]; coste = c }
  }
  if (!mejor) {
    const i = Math.ceil(pal.length / 2)
    mejor = [pal.slice(0, i).join(' '), pal.slice(i).join(' ')]
  }
  return mejor.join('\\N')
}

/** Palabras de la transcripcion dentro de [desde, hasta]. */
function palabrasEn (transcript, desde, hasta) {
  const out = []
  for (const s of transcript.segmentos || []) {
    if (s.out < desde || s.in > hasta) continue
    for (const w of s.palabras || []) {
      if (w.in >= desde - 0.05 && w.out <= hasta + 0.05) out.push(w)
    }
  }
  return out
}

/** Agrupa palabras en cues por puntuacion, largo y duracion. */
export function armarCues (transcript, desde, hasta, { maxLinea = MAX_LINEA } = {}) {
  const palabras = palabrasEn(transcript, desde, hasta)
  const grupos = []
  let act = []
  for (const w of palabras) {
    act.push(w)
    const texto = act.map(x => x.p).join(' ')
    const dur = act[act.length - 1].out - act[0].in
    if (/[.?!]$/.test(w.p) || texto.length >= MAX_CUE || dur >= MAX_DUR) { grupos.push(act); act = [] }
  }
  if (act.length) grupos.push(act)

  // Si no cabe en dos lineas, partimos el grupo.
  const finales = []
  for (const g of grupos) {
    const t = g.map(x => x.p).join(' ')
    const cabe = dosLineas(t, maxLinea).split('\\N').every(l => l.length <= maxLinea)
    if (cabe || g.length < 4) finales.push(g)
    else { const i = Math.ceil(g.length / 2); finales.push(g.slice(0, i)); finales.push(g.slice(i)) }
  }

  const cues = finales.map(g => ({
    in: g[0].in,
    out: g[g.length - 1].out + 0.12,
    texto: g.map(x => x.p).join(' ').replace(/\s+([,.?!])/g, '$1')
  }))
  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i].out > cues[i + 1].in) cues[i].out = cues[i + 1].in - 0.01
  }
  return cues
}

const ESTILO = {
  fuente: 'Montserrat SemiBold',
  tamano: 64,
  texto: '&H00191A1A',   // &HAABBGGRR
  borde: 'caja',         // 'caja' (fondo opaco) o 'contorno' (borde alrededor de la letra)
  caja: '&H00FFFFFF',
  contorno: '&H00000000',
  relleno: 10,           // con borde=caja es el padding; con contorno, su grosor
  sombra: 0,
  margenV: 260,
  // 1-3 abajo, 4-6 en medio, 7-9 arriba. El 5 centra vertical y horizontalmente,
  // que en un apilado cae justo en la union de las dos camaras.
  alineacion: 2,
  maxLinea: 30
}

/**
 * Genera el texto de un .ass. Si `origen` viene, los tiempos se rebasan
 * restandolo: los clips empiezan en 0 aunque salgan del minuto 14.
 */
/**
 * Parte los cues en las fronteras de unas ventanas, para poder tratarlos
 * distinto dentro y fuera. Un cue a caballo se dividiria en dos.
 */
function partirEn (cues, ventanas) {
  if (!ventanas.length) return cues.map(c => ({ ...c, dentro: false }))
  const cortes = ventanas.flatMap(v => [v.in, v.out])
  const salida = []
  for (const c of cues) {
    let ini = c.in
    for (const t of cortes.filter(t => t > c.in && t < c.out).sort((a, b) => a - b)) {
      salida.push({ ...c, in: ini, out: t }); ini = t
    }
    salida.push({ ...c, in: ini, out: c.out })
  }
  return salida
    .filter(c => c.out - c.in > 0.08)   // restos de un corte justo en el borde
    .map(c => ({ ...c, dentro: ventanas.some(v => c.in >= v.in - 0.01 && c.out <= v.out + 0.01) }))
}

export function generarAss (transcript, { desde, hasta, ancho, alto, origen = 0, estilo = {}, correcciones = [], centradoEn = [] }) {
  const e = { ...ESTILO, ...estilo }
  const cues = partirEn(armarCues(transcript, desde, hasta, { maxLinea: e.maxLinea }), centradoEn)

  // BorderStyle 3 pinta una caja opaca detras del texto; 1 dibuja el contorno.
  const estiloBorde = e.borde === 'contorno' ? 1 : 3
  const contorno = e.borde === 'contorno' ? e.contorno : e.caja
  const fondo = e.borde === 'contorno' ? e.contorno : e.caja

  const aplicar = (t) => correcciones.reduce(
    (acc, [patron, rep]) => acc.replace(new RegExp(patron, 'g'), rep), t)

  const cabecera = `[Script Info]
ScriptType: v4.00+
PlayResX: ${ancho}
PlayResY: ${alto}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caja,${e.fuente},${e.tamano},${e.texto},${e.texto},${contorno},${fondo},0,0,0,0,100,100,0,0,${estiloBorde},${e.relleno},${e.sombra},${e.alineacion},60,60,${e.margenV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const filas = cues.map(c => {
    // \an5 centra vertical y horizontalmente. En una vista apilada eso cae
    // exactamente en la union entre las dos camaras.
    const marca = c.dentro ? '{\\an5}' : ''
    return `Dialogue: 0,${hms(c.in - origen)},${hms(c.out - origen)},Caja,,0,0,0,,${marca}${dosLineas(aplicar(c.texto), e.maxLinea)}`
  })
  return { texto: cabecera + filas.join('\n') + '\n', cues: cues.length }
}
