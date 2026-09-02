import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { cfg, dirProyecto } from './config.js'
import { leerJson } from './util.js'
import { generarAss } from './subtitulos.js'
import { dirRenders } from './render.js'

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
function construirFiltro (plan, clip) {
  const { ancho = 1080, alto = 1920 } = plan.formato || {}
  const c = plan.fuente?.contenido || { y: 0, alto: null }
  const personas = plan.fuente?.personas || []
  const disposicion = clip.disposicion || plan.formato?.disposicion || 'apilado'
  const altoFuente = c.alto || 0

  if (disposicion === 'recorte') {
    const quien = clip.persona ?? 0
    const p = personas[quien] || personas[0]
    return `[0:v]crop=${p.ancho}:${altoFuente}:${p.x}:${c.y},scale=${ancho}:${alto}:force_original_aspect_ratio=increase,crop=${ancho}:${alto}[v]`
  }

  const mitad = Math.round(alto / 2)
  const partes = personas.slice(0, 2).map((p, i) =>
    `[0:v]crop=${p.ancho}:${altoFuente}:${p.x}:${c.y},scale=${ancho}:${mitad}:force_original_aspect_ratio=increase,crop=${ancho}:${mitad}[p${i}]`)
  return `${partes.join(';')};[p0][p1]vstack=inputs=2[v]`
}

const claveDe = (entrega, id) => `${entrega}__${id}`

async function renderizarUno (slug, plan, clip, transcript, meta, entrega) {
  const dir = dirClips(slug)
  fs.mkdirSync(dir, { recursive: true })
  const { ancho = 1080, alto = 1920 } = plan.formato || {}

  // .ass propio del clip, con los tiempos rebasados a su inicio
  const clave = claveDe(entrega, clip.id)
  const ass = path.join(dir, `${clave}.ass`)
  const { texto } = generarAss(transcript, {
    desde: clip.in, hasta: clip.out, ancho, alto, origen: clip.in,
    estilo: { ...(plan.estilo || {}), ...(clip.estilo || {}) },
    correcciones: correccionesDe(slug, plan)
  })
  fs.writeFileSync(ass, texto, 'utf8')

  const salida = path.join(dir, `${clave}.mp4`)
  const filtro = `${construirFiltro(plan, clip)};[v]ass=${clave}.ass[vout]`
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(clip.in), '-t', String(Math.max(0.5, clip.out - clip.in)),
    '-i', meta.videoPath,
    '-filter_complex', filtro, '-map', '[vout]', '-map', '0:a?',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    salida
  ]

  await new Promise((resolve, reject) => {
    const p = spawn(cfg.ffmpeg, args, { cwd: dir, windowsHide: true })
    let err = ''
    p.stderr.on('data', d => { err += d })
    p.on('error', e => reject(new Error(`no se pudo ejecutar ffmpeg: ${e.message}`)))
    p.on('close', code => code === 0
      ? resolve()
      : reject(new Error(err.split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || `ffmpeg codigo ${code}`)))
  })
  return salida
}

export function renderizarClips (slug, { entrega, ids = null }) {
  if (cola.get(slug)?.fase === 'renderizando') return estadoClips(slug)

  const plan = leerPlan(slug, entrega)
  if (!plan) throw new Error(`la entrega ${entrega} no tiene clips.json`)
  const meta = leerJson(path.join(dirProyecto(slug), 'meta.json'))
  const transcript = leerJson(path.join(dirProyecto(slug), 'transcript.json'), { segmentos: [] })
  if (!meta || !fs.existsSync(meta.videoPath)) throw new Error('no encuentro el video original')

  const lista = (plan.clips || []).filter(c => !ids || ids.includes(c.id))
  if (!lista.length) throw new Error('no hay clips que renderizar')

  cola.set(slug, { fase: 'renderizando', i: 0, total: lista.length, actual: lista[0].id, entrega })
  ;(async () => {
    for (let i = 0; i < lista.length; i++) {
      cola.set(slug, { fase: 'renderizando', i, total: lista.length, actual: lista[i].id, entrega })
      try {
        await renderizarUno(slug, plan, lista[i], transcript, meta, entrega)
      } catch (e) {
        cola.set(slug, { fase: 'error', i, total: lista.length, actual: lista[i].id, entrega, error: e.message })
        return
      }
    }
    cola.set(slug, { fase: 'listo', i: lista.length, total: lista.length })
  })()

  return estadoClips(slug)
}
