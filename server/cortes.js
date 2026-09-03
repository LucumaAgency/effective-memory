import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { cfg, dirProyecto } from './config.js'
import { leerJson, escribirJson } from './util.js'
import { generarAss } from './subtitulos.js'
import { correccionesDe } from './clips.js'
import { dirRenders } from './render.js'

export const dirCortes = (slug) => path.join(dirRenders(slug), 'cortes')

const cola = new Map()
export const estadoCortes = (slug) => cola.get(slug) || { fase: 'inactivo' }

export function listarCortes (slug) {
  const dir = dirCortes(slug)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).map(f => ({
    archivo: f,
    entrega: f.replace(/\.mp4$/, ''),
    bytes: fs.statSync(path.join(dir, f)).size
  }))
}

export const leerPlanCortes = (slug, entrega) =>
  leerJson(path.join(dirProyecto(slug), 'entregas', entrega, 'cortes.json'), null)

/**
 * Tabla de traduccion original -> render. Es la razon por la que todos los
 * tiempos del proyecto viven en coordenadas del original: aqui se convierten.
 */
export function construirMapa (conservar) {
  let acumulado = 0
  return conservar.map(s => {
    const tramo = { in: s.in, out: s.out, desplazamiento: acumulado - s.in }
    acumulado += s.out - s.in
    return tramo
  })
}

/** Devuelve el tiempo en el render, o null si ese instante fue eliminado. */
export function traducir (mapa, t) {
  for (const s of mapa) {
    if (t >= s.in && t <= s.out) return +(t + s.desplazamiento).toFixed(3)
  }
  return null
}

/** Reubica los cues del .ass en la linea de tiempo del render. */
function reubicarCues (texto, mapa) {
  const aSeg = (h) => {
    const [hh, mm, ss] = h.split(':')
    return Number(hh) * 3600 + Number(mm) * 60 + Number(ss)
  }
  const aHms = (t) => {
    const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60)
    return `${h}:${String(m).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`
  }
  return texto.split('\n').map(linea => {
    const m = /^Dialogue: (\d+),([\d:.]+),([\d:.]+),(.*)$/.exec(linea)
    if (!m) return linea
    const a = traducir(mapa, aSeg(m[2]))
    let b = traducir(mapa, aSeg(m[3]))
    if (a === null) return null                       // el cue cayo en un tramo eliminado
    if (b === null || b < a) {                        // el cue quedo partido: lo recortamos
      const tramo = mapa.find(s => aSeg(m[2]) >= s.in && aSeg(m[2]) <= s.out)
      b = +(tramo.out + tramo.desplazamiento).toFixed(3)
    }
    return `Dialogue: ${m[1]},${aHms(a)},${aHms(b)},${m[4]}`
  }).filter(Boolean).join('\n')
}

export function aplicarCortes (slug, { entrega }) {
  if (cola.get(slug)?.fase === 'aplicando') return estadoCortes(slug)

  const plan = leerPlanCortes(slug, entrega)
  if (!plan) throw new Error(`la entrega ${entrega} no tiene cortes.json`)
  const meta = leerJson(path.join(dirProyecto(slug), 'meta.json'))
  if (!meta || !fs.existsSync(meta.videoPath)) throw new Error('no encuentro el video original')

  const conservar = (plan.conservar || []).filter(s => s.out > s.in)
  if (!conservar.length) throw new Error('cortes.json no conserva ningun tramo')

  const dir = dirCortes(slug)
  fs.mkdirSync(dir, { recursive: true })
  const mapa = construirMapa(conservar)
  const duracion = conservar.reduce((s, x) => s + (x.out - x.in), 0)

  // El grafo de filtros va a un archivo: con decenas de tramos la linea de
  // comandos de Windows se queda corta.
  const fundido = Math.max(0, Math.min(plan.crossfade ?? 0.03, 0.2))
  const partes = []
  conservar.forEach((s, i) => {
    const d = s.out - s.in
    partes.push(`[0:v]trim=start=${s.in}:end=${s.out},setpts=PTS-STARTPTS[v${i}]`)
    const fades = fundido > 0
      ? `,afade=t=in:st=0:d=${fundido},afade=t=out:st=${Math.max(0, d - fundido).toFixed(3)}:d=${fundido}`
      : ''
    partes.push(`[0:a]atrim=start=${s.in}:end=${s.out},asetpts=PTS-STARTPTS${fades}[a${i}]`)
  })
  const etiquetas = conservar.map((_, i) => `[v${i}][a${i}]`).join('')
  partes.push(`${etiquetas}concat=n=${conservar.length}:v=1:a=1[vc][a]`)

  let salidaVideo = '[vc]'
  if (plan.subtitulos) {
    const transcript = leerJson(path.join(dirProyecto(slug), 'transcript.json'), { segmentos: [] })
    const { texto } = generarAss(transcript, {
      desde: 0, hasta: meta.duracion || 1e9,
      ancho: meta.ancho || 1280, alto: meta.alto || 720,
      estilo: plan.estilo || {}, correcciones: correccionesDe(slug, plan)
    })
    fs.writeFileSync(path.join(dir, `${entrega}.ass`), reubicarCues(texto, mapa), 'utf8')
    partes.push(`[vc]ass=${entrega}.ass[vs]`)
    salidaVideo = '[vs]'
  }

  const guion = path.join(dir, `${entrega}.filtro`)
  fs.writeFileSync(guion, partes.join(';\n'), 'utf8')
  escribirJson(path.join(dir, `${entrega}.mapa.json`), { entrega, duracion, tramos: mapa })

  const salida = path.join(dir, `${entrega}.mp4`)
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', meta.videoPath,
    '-filter_complex_script', `${entrega}.filtro`,
    '-map', salidaVideo, '-map', '[a]',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', salida
  ]

  cola.set(slug, {
    fase: 'aplicando', progreso: 0, entrega,
    tramos: conservar.length,
    duracionOriginal: meta.duracion || 0,
    duracionFinal: duracion
  })

  const p = spawn(cfg.ffmpeg, args, { cwd: dir, windowsHide: true })
  let err = ''
  p.stdout.on('data', d => {
    const m = /out_time_ms=(\d+)/.exec(d.toString())
    if (m) {
      const t = cola.get(slug)
      cola.set(slug, { ...t, progreso: Math.min(99, (Number(m[1]) / 1e6 / duracion) * 100) })
    }
  })
  p.stderr.on('data', d => { err += d })
  p.on('error', e => cola.set(slug, { fase: 'error', error: `no se pudo ejecutar ffmpeg: ${e.message}` }))
  p.on('close', code => {
    const t = cola.get(slug)
    if (code === 0) cola.set(slug, { ...t, fase: 'listo', progreso: 100 })
    else cola.set(slug, { fase: 'error', entrega, error: err.split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || `ffmpeg codigo ${code}` })
  })

  return estadoCortes(slug)
}
