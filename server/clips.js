import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { cfg, dirProyecto } from './config.js'
import { leerJson } from './util.js'
import { leerMeta } from './proyectos.js'
import { generarAss } from './subtitulos.js'
import { dirRenders } from './render.js'
import { leerPlanGraficos, generar as generarGrafico, faltanRecursos } from './graficos.js'

export const dirClips = (slug) => path.join(dirRenders(slug), 'clips')

const cola = new Map()   // slug -> { fase, i, total, actual, error }
export const estadoClips = (slug) => cola.get(slug) || { fase: 'inactivo' }

export function listarClipsRenderizados (slug) {
  const dir = dirClips(slug)
  if (!fs.existsSync(dir)) return []
  // El nombre lleva la entrega delante: los ids se repiten entre entregas y
  // sin esto la v3 pisaria los renders de la v2.
  return fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).map(f => {
    const base = f.replace(/\.mp4$/, '')
    const i = base.indexOf('__')
    return {
      archivo: f,
      clave: base,
      entrega: i > 0 ? base.slice(0, i) : null,
      id: i > 0 ? base.slice(i + 2) : base,
      bytes: fs.statSync(path.join(dir, f)).size
    }
  })
}

/**
 * Correcciones de texto del proyecto (nombres propios que el ASR no puede saber)
 * mas las propias del plan. Se escriben una vez en correcciones.json y valen
 * para todo lo que se genere despues.
 */
export function correccionesDe (slug, plan = {}) {
  const propias = leerJson(path.join(dirProyecto(slug), 'correcciones.json'), null)
  const lista = Array.isArray(propias) ? propias : (propias?.reemplazos || [])
  return [...lista, ...(plan.correcciones || [])]
}

/** Lee clips.json de una entrega. */
export function leerPlan (slug, entrega) {
  const f = path.join(dirProyecto(slug), 'entregas', entrega, 'clips.json')
  return leerJson(f, null)
}

/**
 * Construye el filtro de video.
 *  - "apilado": corta a cada persona de la pantalla partida y los apila (2 cabezas parlantes).
 *  - "recorte": una sola persona a pantalla completa.
 */
export const par = (v) => Math.max(0, Math.round(Number(v) || 0) & ~1)

/**
 * @param ramas etiquetas de flujo ya derivadas de [0:v]. Si no se pasan, el
 *   filtro las crea el mismo. Usar [0:v] mas de una vez en el mismo grafo
 *   funciona en unas versiones de ffmpeg y revienta en otras, asi que la
 *   division se hace UNA sola vez, arriba.
 */
export function construirFiltro (plan, clip, ramas = null) {
  // Un clip puede pisar el encuadre del plan: en una entrevista a dos camaras,
  // los tramos donde solo habla uno piden un encuadre distinto.
  const formato = { ...(plan.formato || {}), ...(clip.formato || {}) }
  const fuente = clip.fuente || plan.fuente || {}
  const { ancho = 1080, alto = 1920 } = formato
  const c = fuente.contenido || { y: 0, alto: null }
  const personas = fuente.personas || []
  const disposicion = clip.disposicion || formato.disposicion || 'apilado'
  const altoFuente = c.alto || 0

  // "fondo": la franja util del video, nitida, sobre una copia de si misma
  // ampliada y difuminada. Para fuentes muy apaisadas (una videollamada con
  // barras negras) donde recortar a 9:16 obligaria a ampliar 5 veces.
  // Cada persona puede traer su propio recorte vertical: una webcam puede venir
  // enmarcada dentro de su panel, con bordes oscuros que hay que quitar.
  const recorteDe = (p) =>
    `crop=${par(p.ancho)}:${par(p.alto ?? altoFuente)}:${par(p.x)}:${par(p.y ?? c.y)}`

  const r = (i) => ramas ? ramas[i] : null

  if (disposicion === 'fondo') {
    const quien = clip.persona ?? 0
    const p = personas[quien] || personas[0] || { x: 0, ancho: ancho }
    const recorte = recorteDe(p)
    const altoTira = par(alto * (formato.altoTira ?? 0.32))
    const arriba = par(alto * (formato.tiraY ?? 0.16))
    // El recorte se hace una vez y se divide con split: usar [0:v] dos veces
    // funciona en unas versiones de ffmpeg y falla en otras. Ademas asi el
    // recorte no se calcula dos veces.
    const partes = ramas
      ? [`[${r(0)}]${recorte}[base1]`, `[${r(1)}]${recorte}[base2]`]
      : [`[0:v]${recorte},split=2[base1][base2]`]
    return [
      ...partes,
      `[base1]scale=${ancho}:${alto}:force_original_aspect_ratio=increase,` +
        `crop=${ancho}:${alto},boxblur=24:2,eq=brightness=-0.14:saturation=0.8[bg]`,
      `[base2]scale=${ancho}:${altoTira}:force_original_aspect_ratio=increase,` +
        `crop=${ancho}:${altoTira}[fg]`,
      `[bg][fg]overlay=0:${arriba}[v]`
    ].join(';')
  }

  if (disposicion === 'recorte') {
    const quien = clip.persona ?? 0
    const p = personas[quien] || personas[0]
    return `[${r(0) || '0:v'}]${recorteDe(p)},` +
      `scale=${ancho}:${alto}:force_original_aspect_ratio=increase,crop=${ancho}:${alto}[v]`
  }

  const mitad = Math.round(alto / 2)
  const partes = [...(ramas ? [] : [`[0:v]split=2[s0][s1]`]), ...personas.slice(0, 2).map((p, i) =>
    `[${ramas ? r(i) : `s${i}`}]${recorteDe(p)},` +
    `scale=${ancho}:${mitad}:force_original_aspect_ratio=increase,crop=${ancho}:${mitad}[p${i}]`)]
  return `${partes.join(';')};[p0][p1]vstack=inputs=2[v]`
}

const claveDe = (entrega, id) => `${entrega}__${id}`

/**
 * Insertos de reaccion: durante esas ventanas la franja se parte en dos
 * columnas, el que habla a la izquierda y el otro a la derecha. Es el plano de
 * reaccion de toda la vida, pero sin salir del mismo archivo de video.
 *
 * Devuelve el trozo de filtro a encadenar y la etiqueta de salida.
 */
function filtroInsertos (plan, clip, entrada, ramas) {
  const insertos = (clip.insertos || []).filter(x => x.out > x.in)
  if (!insertos.length) return { cadena: '', salida: entrada }

  const formato = { ...(plan.formato || {}), ...(clip.formato || {}) }
  const fuente = clip.fuenteInserto || plan.fuente || {}
  const personas = fuente.personas || []
  if (personas.length < 2) return { cadena: '', salida: entrada }

  const { ancho = 1080, alto = 1920 } = formato
  const altoTira = par(alto * (formato.altoTira ?? 0.32))
  const arriba = par(alto * (formato.tiraY ?? 0.16))
  const media = par(ancho / 2)
  const c = fuente.contenido || { y: 0, alto: 0 }
  const recorte = (p) =>
    `crop=${par(p.ancho)}:${par(p.alto ?? c.alto)}:${par(p.x)}:${par(p.y ?? c.y)}`

  const partes = [
    `[${ramas[0]}]${recorte(personas[0])},scale=${media}:${altoTira}:force_original_aspect_ratio=increase,crop=${media}:${altoTira}[ia]`,
    `[${ramas[1]}]${recorte(personas[1])},scale=${media}:${altoTira}:force_original_aspect_ratio=increase,crop=${media}:${altoTira}[ib]`,
    `[ia][ib]hstack=inputs=2[dividido]`
  ]
  // Una salida de filtro solo se puede consumir una vez: si hay varias
  // ventanas, hay que duplicar el flujo.
  if (insertos.length > 1) {
    partes.push(`[dividido]split=${insertos.length}` + insertos.map((_, i) => `[div${i}]`).join(''))
  }

  let ultima = entrada
  insertos.forEach((x, i) => {
    const fuenteDiv = insertos.length > 1 ? `div${i}` : 'dividido'
    const desde = +(x.in - clip.in).toFixed(3)
    const hasta = +(x.out - clip.in).toFixed(3)
    partes.push(`[${ultima}][${fuenteDiv}]overlay=0:${arriba}:` +
      `enable='between(t,${desde},${hasta})'[ins${i}]`)
    ultima = `ins${i}`
  })
  return { cadena: ';' + partes.join(';'), salida: ultima }
}

/** Gráficos de esta entrega que caen sobre este clip. */
function graficosDe (slug, entrega, clip) {
  const plan = leerPlanGraficos(slug, entrega)
  return (plan?.graficos || []).filter(g => g.clip === clip.id)
}

async function renderizarUno (slug, plan, clip, transcript, meta, entrega, avisar = () => {}) {
  const dir = dirClips(slug)
  fs.mkdirSync(dir, { recursive: true })
  const { ancho = 1080, alto = 1920 } = plan.formato || {}

  // .ass propio del clip, con los tiempos rebasados a su inicio
  const clave = claveDe(entrega, clip.id)

  // "subtitulos": false en el plan (o en un clip suelto) los desactiva.
  const conSubtitulos = (clip.subtitulos ?? plan.subtitulos) !== false
  const ass = path.join(dir, `${clave}.ass`)
  if (conSubtitulos) {
    const { texto } = generarAss(transcript, {
      desde: clip.in, hasta: clip.out, ancho, alto, origen: clip.in,
      estilo: { ...(plan.estilo || {}), ...(clip.estilo || {}) },
      correcciones: correccionesDe(slug, plan)
    })
    fs.writeFileSync(ass, texto, 'utf8')
  } else if (fs.existsSync(ass)) {
    fs.unlinkSync(ass)
  }

  const salida = path.join(dir, `${clave}.mp4`)

  // Cada grafico entra como una entrada mas y se superpone en su ventana de tiempo,
  // que va en coordenadas del original igual que todo lo demas.
  const graficos = graficosDe(slug, entrega, clip)
  const entradas = []
  const disposicion = clip.disposicion || clip.formato?.disposicion || plan.formato?.disposicion || 'apilado'
  const hayInsertos = (clip.insertos || []).some(x => x.out > x.in)
  const nBase = disposicion === 'recorte' ? 1 : 2
  const nRamas = nBase + (hayInsertos ? 2 : 0)
  const ramas = Array.from({ length: nRamas }, (_, i) => `r${i}`)

  let cadena = `[0:v]split=${nRamas}${ramas.map(x => `[${x}]`).join('')};`
  cadena += construirFiltro(plan, clip, ramas.slice(0, nBase))   // termina en [v]
  let ultima = 'v'

  if (hayInsertos) {
    const ins = filtroInsertos(plan, clip, ultima, ramas.slice(nBase))
    cadena += ins.cadena
    ultima = ins.salida
  }

  // Los graficos van DEBAJO de los subtitulos: un b-roll a pantalla completa no
  // debe tapar el texto.
  // n cuenta las entradas de ffmpeg, que no coinciden con el indice del bucle
  // en cuanto se omite un grafico.
  let n = 0
  for (const g of graficos) {
    // Un grafico sin su imagen se omite: generarlo daria un WebM totalmente
    // transparente, y eso se compone como un rectangulo negro sobre el video.
    const faltan = faltanRecursos(slug, entrega, g)
    if (faltan.length) {
      console.log(`[${slug}] gráfico ${g.id} omitido, falta ${faltan.map(f => path.basename(f)).join(', ')}`)
      continue
    }
    const webm = await generarGrafico(slug, entrega, g,
      { alAvanzar: (pc) => avisar(`gráfico ${g.id}`, pc) })
    entradas.push('-i', webm)
    n++
    const desde = +(g.in - clip.in).toFixed(3)
    const hasta = +(g.out - clip.in).toFixed(3)
    // setpts retrasa el grafico hasta su momento; sin esto empezaria en el
    // segundo 0 del clip y ya habria terminado cuando toca mostrarlo.
    cadena += `;[${n}:v]setpts=PTS+${desde}/TB[g${n}]`
    cadena += `;[${ultima}][g${n}]overlay=${g.x || 0}:${g.y || 0}:` +
      `enable='between(t,${desde},${hasta})':eof_action=pass[vg${n}]`
    ultima = `vg${n}`
  }

  cadena += conSubtitulos ? `;[${ultima}]ass=${clave}.ass[vout]` : `;[${ultima}]copy[vout]`

  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(clip.in), '-t', String(Math.max(0.5, clip.out - clip.in)),
    '-i', meta.videoPath,
    ...entradas,
    '-filter_complex', cadena, '-map', '[vout]', '-map', '0:a?',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    salida
  ]
  const duracionClip = Math.max(0.5, clip.out - clip.in)

  await new Promise((resolve, reject) => {
    const p = spawn(cfg.ffmpeg, args, { cwd: dir, windowsHide: true })
    let err = ''
    p.stdout.on('data', d => {
      const m = /out_time_ms=(\d+)/.exec(d.toString())
      if (m) avisar('renderizando', Math.min(99, (Number(m[1]) / 1e6 / duracionClip) * 100))
    })
    p.stderr.on('data', d => { err += d })
    p.on('error', e => reject(new Error(`no se pudo ejecutar ffmpeg: ${e.message}`)))
    p.on('close', code => {
      if (code === 0) return resolve()
      const registro = path.join(dir, `${clave}.log`)
      fs.writeFileSync(registro, `${cfg.ffmpeg} ${args.join(' ')}\n\n${err}`, 'utf8')
      const lineas = err.split(/\r?\n/).filter(Boolean)
      // La primera linea que menciona un error suele ser la causa; la cola es consecuencia.
      const causa = lineas.find(l => /error|invalid|no such|failed|unable|cannot/i.test(l)) || lineas[0]
      reject(new Error(`${causa || `ffmpeg codigo ${code}`}  ·  log completo en ${registro}`))
    })
  })
  return salida
}

const ATASCO_MS = 10 * 60 * 1000

export function renderizarClips (slug, { entrega, ids = null }) {
  const previo = cola.get(slug)
  // Si un render murio de forma rara, el estado se quedaria en "renderizando"
  // para siempre y los botones bloqueados. Pasados 10 minutos sin avanzar, seguimos.
  if (previo?.fase === 'renderizando' && Date.now() - (previo.latido || 0) < ATASCO_MS) {
    return estadoClips(slug)
  }

  const plan = leerPlan(slug, entrega)
  if (!plan) throw new Error(`la entrega ${entrega} no tiene clips.json`)
  const meta = leerMeta(slug)
  const transcript = leerJson(path.join(dirProyecto(slug), 'transcript.json'), { segmentos: [] })
  if (!meta || !fs.existsSync(meta.videoPath)) throw new Error('no encuentro el video original')

  const lista = (plan.clips || []).filter(c => !ids || ids.includes(c.id))
  if (!lista.length) throw new Error('no hay clips que renderizar')

  cola.set(slug, { fase: 'renderizando', i: 0, total: lista.length, actual: lista[0].id, entrega, latido: Date.now() })
  ;(async () => {
    for (let i = 0; i < lista.length; i++) {
      cola.set(slug, { fase: 'renderizando', i, total: lista.length, actual: lista[i].id, entrega, paso: 'preparando', pc: 0, latido: Date.now() })
      try {
        await renderizarUno(slug, plan, lista[i], transcript, meta, entrega, (paso, pc) => {
          const t = cola.get(slug)
          if (t?.fase === 'renderizando') cola.set(slug, { ...t, paso, pc: Math.round(pc), latido: Date.now() })
        })
      } catch (e) {
        cola.set(slug, { fase: 'error', i, total: lista.length, actual: lista[i].id, entrega, error: e.message })
        return
      }
    }
    cola.set(slug, { fase: 'listo', i: lista.length, total: lista.length })
  })()

  return estadoClips(slug)
}
