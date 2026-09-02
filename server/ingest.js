import fs from 'node:fs'
import path from 'node:path'
import { cfg, dirProyecto, RAIZ } from './config.js'
import { correr, escribirJson, leerJson } from './util.js'

// Estado de los ingests en curso, en memoria. El resumen se espeja en estado.json.
const trabajos = new Map()

export const estadoIngest = (slug) => trabajos.get(slug) ||
  leerJson(path.join(dirProyecto(slug), 'estado.json'), { fase: 'sin-ingest', progreso: 0 })

function marcar (slug, parcial) {
  const previo = trabajos.get(slug) || {}
  const est = { ...previo, ...parcial, actualizado: new Date().toISOString() }
  trabajos.set(slug, est)
  escribirJson(path.join(dirProyecto(slug), 'estado.json'), est)
  return est
}

async function sondear (videoPath) {
  const { out } = await correr(cfg.ffprobe, [
    '-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', videoPath
  ])
  const d = JSON.parse(out)
  const v = d.streams.find(s => s.codec_type === 'video') || {}
  const a = d.streams.find(s => s.codec_type === 'audio')
  const [n, den] = String(v.avg_frame_rate || '0/1').split('/').map(Number)
  return {
    duracion: Number(d.format.duration || 0),
    bytes: Number(d.format.size || 0),
    ancho: v.width || 0,
    alto: v.height || 0,
    fps: den ? +(n / den).toFixed(3) : 0,
    tieneAudio: !!a
  }
}

// ffmpeg silencedetect -> lista de tramos silenciosos en coordenadas del ORIGINAL
async function detectarSilencios (videoPath) {
  let log = ''
  try {
    await correr(cfg.ffmpeg, [
      '-hide_banner', '-nostats', '-i', videoPath,
      '-af', `silencedetect=noise=${cfg.silencioDb}dB:d=${cfg.silencioMin}`,
      '-f', 'null', '-'
    ], { onStderr: t => { log += t } })
  } catch (e) { log += e.err || '' }

  const tramos = []
  let inicio = null
  for (const linea of log.split(/\r?\n/)) {
    const a = linea.match(/silence_start:\s*(-?[\d.]+)/)
    if (a) { inicio = Number(a[1]); continue }
    const b = linea.match(/silence_end:\s*([\d.]+)/)
    if (b && inicio !== null) {
      const fin = Number(b[1])
      tramos.push({ in: +Math.max(0, inicio).toFixed(3), out: +fin.toFixed(3), dur: +(fin - inicio).toFixed(3) })
      inicio = null
    }
  }
  return { umbralDb: cfg.silencioDb, duracionMin: cfg.silencioMin, tramos }
}

// Muestreo grueso: un frame cada N segundos. Los frames finos se piden bajo demanda.
async function extraerFrames (videoPath, slug, duracion) {
  const dir = path.join(dirProyecto(slug), 'frames')
  fs.mkdirSync(dir, { recursive: true })
  await correr(cfg.ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', videoPath,
    '-vf', `fps=1/${cfg.frameCada},scale=${cfg.frameAncho}:-2`,
    '-q:v', '5', '-start_number', '0',
    path.join(dir, 'm%04d.jpg')
  ])
  const archivos = fs.readdirSync(dir).filter(f => /^m\d+\.jpg$/.test(f)).sort()
  return archivos.map((f, i) => ({
    archivo: `frames/${f}`,
    t: +(i * cfg.frameCada).toFixed(2)
  })).filter(x => x.t <= duracion + cfg.frameCada)
}

// Frame exacto bajo demanda, cacheado en disco.
export async function frameEn (slug, t, videoPath) {
  const dir = path.join(dirProyecto(slug), 'frames')
  fs.mkdirSync(dir, { recursive: true })
  const destino = path.join(dir, `t${t.toFixed(2).replace('.', '_')}.jpg`)
  if (!fs.existsSync(destino)) {
    await correr(cfg.ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', String(t), '-i', videoPath, '-frames:v', '1',
      '-vf', `scale=${cfg.frameAncho}:-2`, '-q:v', '4', '-y', destino
    ])
  }
  return destino
}

async function transcribir (videoPath, slug) {
  const salida = path.join(dirProyecto(slug), 'transcript.json')
  await correr(cfg.python, [
    path.join(RAIZ, 'scripts', 'transcribir.py'),
    videoPath, salida,
    '--modelo', cfg.whisperModelo,
    '--device', cfg.whisperDevice,
    '--idioma', cfg.whisperLang
  ], { onStderr: t => {
    const m = t.match(/PROGRESO\s+([\d.]+)/)
    if (m) marcar(slug, { fase: 'transcribiendo', progreso: 40 + Number(m[1]) * 0.55 })
  } })
  return leerJson(salida)
}

export async function ingestar (slug) {
  const dir = dirProyecto(slug)
  const meta = leerJson(path.join(dir, 'meta.json'))
  if (!meta) throw new Error(`Proyecto ${slug} sin meta.json`)
  if (!fs.existsSync(meta.videoPath)) throw new Error(`No existe el video: ${meta.videoPath}`)

  try {
    marcar(slug, { fase: 'sondeando', progreso: 2, error: null })
    const info = await sondear(meta.videoPath)
    escribirJson(path.join(dir, 'meta.json'), { ...meta, ...info, ingestado: new Date().toISOString() })

    marcar(slug, { fase: 'silencios', progreso: 12 })
    escribirJson(path.join(dir, 'silencios.json'), await detectarSilencios(meta.videoPath))

    marcar(slug, { fase: 'frames', progreso: 25 })
    escribirJson(path.join(dir, 'frames.json'), { cada: cfg.frameCada, muestras: await extraerFrames(meta.videoPath, slug, info.duracion) })

    if (info.tieneAudio) {
      marcar(slug, { fase: 'transcribiendo', progreso: 40 })
      await transcribir(meta.videoPath, slug)
    } else {
      escribirJson(path.join(dir, 'transcript.json'), { idioma: null, segmentos: [], nota: 'el video no tiene pista de audio' })
    }

    return marcar(slug, { fase: 'listo', progreso: 100 })
  } catch (e) {
    marcar(slug, { fase: 'error', error: e.message })
    throw e
  }
}

export function lanzarIngest (slug) {
  if (trabajos.get(slug)?.fase && !['listo', 'error', 'sin-ingest'].includes(trabajos.get(slug).fase)) {
    return estadoIngest(slug)
  }
  marcar(slug, { fase: 'en-cola', progreso: 0, error: null })
  ingestar(slug).catch(e => console.error(`[ingest ${slug}]`, e.message))
  return estadoIngest(slug)
}
