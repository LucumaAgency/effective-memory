import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { cfg, dirProyecto } from './config.js'
import { leerJson } from './util.js'

// Los renders son binarios: viven fuera del arbol versionado del proyecto.
export const dirRenders = (slug) => path.join(cfg.dataRepo, 'renders', slug)

const trabajos = new Map()
export const estadoRender = (slug) => trabajos.get(slug) || { fase: 'inactivo' }

export function listarRenders (slug) {
  const dir = dirRenders(slug)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).map(f => {
    const st = fs.statSync(path.join(dir, f))
    return { archivo: f, bytes: st.size, creado: st.mtime.toISOString() }
  }).sort((a, b) => b.creado.localeCompare(a.creado))
}

/**
 * Quema una entrega sobre el video original en un rango de tiempo.
 * Corre ffmpeg con cwd en la carpeta de la entrega para poder usar el nombre
 * del .ass sin ruta: escapar rutas de Windows dentro de un filtro es un infierno.
 */
export function renderizar (slug, { entrega, desde = 0, hasta = null }) {
  const enCurso = trabajos.get(slug)
  if (enCurso && enCurso.fase === 'renderizando') return enCurso

  const meta = leerJson(path.join(dirProyecto(slug), 'meta.json'))
  if (!meta) throw new Error('proyecto sin meta.json')
  if (!fs.existsSync(meta.videoPath)) throw new Error(`no existe el video: ${meta.videoPath}`)

  const dirEntrega = path.join(dirProyecto(slug), 'entregas', entrega)
  const ass = fs.existsSync(dirEntrega) && fs.readdirSync(dirEntrega).find(f => f.endsWith('.ass') || f.endsWith('.srt'))
  if (!ass) throw new Error(`la entrega ${entrega} no tiene subtitulos`)

  const ini = Math.max(0, Number(desde) || 0)
  const fin = hasta == null ? (meta.duracion || 0) : Number(hasta)
  const dur = Math.max(0.5, fin - ini)

  const salidaDir = dirRenders(slug)
  fs.mkdirSync(salidaDir, { recursive: true })
  const nombre = `${entrega}_${Math.round(ini)}-${Math.round(fin)}.mp4`
  const salida = path.join(salidaDir, nombre)

  const filtro = ass.endsWith('.ass') ? `ass=${ass}` : `subtitles=${ass}`
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(ini), '-t', String(dur), '-i', meta.videoPath,
    '-vf', filtro,
    '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '160k',
    '-progress', 'pipe:1', '-nostats',
    salida
  ]

  const p = spawn(cfg.ffmpeg, args, { cwd: dirEntrega, windowsHide: true })
  trabajos.set(slug, { fase: 'renderizando', progreso: 0, archivo: nombre, entrega, desde: ini, hasta: fin })

  let err = ''
  p.stdout.on('data', d => {
    const m = /out_time_ms=(\d+)/.exec(d.toString())
    if (m) {
      const t = trabajos.get(slug)
      trabajos.set(slug, { ...t, progreso: Math.min(99, (Number(m[1]) / 1e6 / dur) * 100) })
    }
  })
  p.stderr.on('data', d => { err += d })
  p.on('error', e => trabajos.set(slug, { fase: 'error', error: `no se pudo ejecutar ffmpeg: ${e.message}` }))
  p.on('close', code => {
    if (code === 0) {
      trabajos.set(slug, { fase: 'listo', progreso: 100, archivo: nombre, entrega, desde: ini, hasta: fin })
    } else {
      const util = err.split(/\r?\n/).filter(Boolean).slice(-2).join(' ')
      trabajos.set(slug, { fase: 'error', error: util || `ffmpeg salio con codigo ${code}` })
    }
  })

  return estadoRender(slug)
}
