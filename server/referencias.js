import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.js'
import { correr, leerJson, escribirJson, slugify } from './util.js'
import * as AN from './analisis.js'

// Las referencias son de estilo, no de contenido: viven aparte de los proyectos.
export const dirReferencias = () => path.join(cfg.dataRepo, 'referencias')
export const dirReferencia = (slug) => path.join(dirReferencias(), slug)

const trabajos = new Map()
export const estadoRef = (slug) => trabajos.get(slug) ||
  leerJson(path.join(dirReferencia(slug), 'estado.json'), { fase: 'sin-ingest', progreso: 0 })

function marcar (slug, parcial) {
  const est = { ...(trabajos.get(slug) || {}), ...parcial, actualizado: new Date().toISOString() }
  trabajos.set(slug, est)
  escribirJson(path.join(dirReferencia(slug), 'estado.json'), est)
  return est
}

export function listar () {
  const dir = dirReferencias()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
    const meta = leerJson(path.join(dir, d.name, 'meta.json'), {})
    const med = leerJson(path.join(dir, d.name, 'medidas.json'), null)
    return {
      slug: d.name, titulo: meta.titulo || d.name,
      duracion: meta.duracion || 0, creado: meta.creado || null,
      fase: estadoRef(d.name).fase, progreso: estadoRef(d.name).progreso || 0,
      medidas: med, tieneEstilo: fs.existsSync(path.join(dir, d.name, 'estilo.json'))
    }
  }).sort((a, b) => String(b.creado).localeCompare(String(a.creado)))
}

export function crear ({ titulo, videoPath }) {
  if (!videoPath) throw new Error('Falta la ruta del video')
  const limpio = videoPath.trim().replace(/^["']|["']$/g, '').trim()
  if (!fs.existsSync(limpio)) throw new Error(`No existe esa ruta: ${limpio}`)
  if (fs.statSync(limpio).isDirectory()) throw new Error('Eso es una carpeta, no un video')

  const base = slugify(titulo || path.parse(limpio).name)
  let slug = base, n = 2
  while (fs.existsSync(dirReferencia(slug))) slug = `${base}-${n++}`
  fs.mkdirSync(dirReferencia(slug), { recursive: true })
  escribirJson(path.join(dirReferencia(slug), 'meta.json'), {
    slug, titulo: titulo || path.parse(limpio).name, videoPath: limpio,
    creado: new Date().toISOString()
  })
  return slug
}

async function sondear (v) {
  const { out } = await correr(cfg.ffprobe, ['-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', v])
  const d = JSON.parse(out)
  const vs = d.streams.find(s => s.codec_type === 'video') || {}
  const as = d.streams.find(s => s.codec_type === 'audio')
  const [n, den] = String(vs.avg_frame_rate || '0/1').split('/').map(Number)
  return {
    duracion: Number(d.format.duration || 0), ancho: vs.width || 0, alto: vs.height || 0,
    fps: den ? +(n / den).toFixed(3) : 0,
    relacion: vs.width && vs.height ? +(vs.width / vs.height).toFixed(4) : 0,
    tieneAudio: !!as
  }
}

/** Cambios de plano. La duracion media de plano es la medida que mas define el ritmo. */

/** Sonoridad integrada: delata si lleva musica de fondo y a que nivel esta mezclada. */

/** Estadisticas de color: saturacion y brillo medios sobre una muestra. */

/** Hojas de contacto + frames sueltos + recortes de la zona del subtitulo. */
async function imagenes (v, slug, info, cortes) {
  const dir = dirReferencia(slug)
  const dHojas = path.join(dir, 'hojas')
  const dFrames = path.join(dir, 'frames')
  const dSubs = path.join(dir, 'subtitulos')
  for (const d of [dFrames, dSubs]) {
    fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true })
  }

  const listaHojas = await AN.hojas(v, dHojas)

  // Un frame entero en cada cambio de plano, a resolucion original.
  const instantes = (cortes.length ? cortes : [])
    .concat([0.3, info.duracion / 2, Math.max(0, info.duracion - 0.5)])
    .filter((t, i, a) => a.indexOf(t) === i && t >= 0 && t < info.duracion)
    .sort((a, b) => a - b).slice(0, 24)

  for (const t of instantes) {
    const nombre = `t${t.toFixed(2).replace('.', '_')}.jpg`
    await correr(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(t + 0.12),
      '-i', v, '-frames:v', '1', '-q:v', '3', path.join(dFrames, nombre)])
    // La tipografia no se distingue en miniatura: la mitad inferior sin escalar.
    await correr(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(t + 0.12),
      '-i', v, '-frames:v', '1', '-vf', `crop=${info.ancho}:${Math.round(info.alto * 0.5)}:0:${Math.round(info.alto * 0.42)}`,
      '-q:v', '2', path.join(dSubs, nombre)])
  }

  return {
    hojas: listaHojas,
    fpsHoja: AN.HOJA.fps, columnas: AN.HOJA.cols, filas: AN.HOJA.filas,
    frames: fs.readdirSync(dFrames).sort(),
    recortes: fs.readdirSync(dSubs).sort()
  }
}

async function transcribir (v, slug) {
  const salida = path.join(dirReferencia(slug), 'transcript.json')
  await correr(cfg.python, [path.join(cfg.raizApp, 'scripts', 'transcribir.py'), v, salida,
    '--modelo', cfg.whisperModelo, '--device', cfg.whisperDevice, '--idioma', cfg.whisperLang])
  return leerJson(salida)
}

export async function ingestar (slug) {
  const dir = dirReferencia(slug)
  const meta = leerJson(path.join(dir, 'meta.json'))
  if (!meta) throw new Error('referencia sin meta.json')
  if (!fs.existsSync(meta.videoPath)) throw new Error(`no existe el video: ${meta.videoPath}`)
  const v = meta.videoPath

  try {
    marcar(slug, { fase: 'sondeando', progreso: 4, error: null })
    const info = await sondear(v)
    escribirJson(path.join(dir, 'meta.json'), { ...meta, ...info })

    marcar(slug, { fase: 'escenas', progreso: 18 })
    const cortes = await AN.escenas(v)

    marcar(slug, { fase: 'audio', progreso: 34 })
    const audio = info.tieneAudio ? await AN.sonoridad(v) : null

    marcar(slug, { fase: 'color', progreso: 46 })
    const col = await AN.color(v)

    marcar(slug, { fase: 'imagenes', progreso: 58 })
    const imgs = await imagenes(v, slug, info, cortes)

    marcar(slug, { fase: 'subtitulos', progreso: 70 })
    const subs = await AN.medirSubtitulos(v, info).catch(() => null)

    let transcript = { segmentos: [] }
    if (info.tieneAudio) {
      marcar(slug, { fase: 'transcribiendo', progreso: 76 })
      try { transcript = await transcribir(v, slug) } catch (e) {
        marcar(slug, { avisoTranscripcion: e.message })
      }
    }

    const planos = cortes.length
      ? +(info.duracion / (cortes.length + 1)).toFixed(2)
      : +info.duracion.toFixed(2)

    escribirJson(path.join(dir, 'medidas.json'), {
      formato: { ancho: info.ancho, alto: info.alto, fps: info.fps, relacion: info.relacion,
        vertical: info.relacion > 0 && info.relacion < 1 },
      ritmo: { cortes: cortes.length, planoMedio: planos, instantes: cortes },
      habla: AN.ritmoDeHabla(transcript, info.duracion),
      subtitulos: subs,
      audio, color: col, imagenes: imgs
    })

    return marcar(slug, { fase: 'listo', progreso: 100 })
  } catch (e) {
    marcar(slug, { fase: 'error', error: e.message })
    throw e
  }
}

export function lanzarIngest (slug) {
  const est = trabajos.get(slug)
  if (est && !['listo', 'error', 'sin-ingest'].includes(est.fase)) return est
  marcar(slug, { fase: 'en-cola', progreso: 0, error: null })
  ingestar(slug).catch(e => console.error(`[referencia ${slug}]`, e.message))
  return estadoRef(slug)
}

export function borrar (slug) {
  const dir = dirReferencia(slug)
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}
