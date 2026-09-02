import fs from 'node:fs'
import path from 'node:path'
import { dirProyectos, dirProyecto } from './config.js'
import { leerJson, escribirJson, slugify } from './util.js'

const ARCHIVOS = {
  meta: 'meta.json',
  transcript: 'transcript.json',
  silencios: 'silencios.json',
  frames: 'frames.json',
  comentarios: 'comentarios.json'
}

export function listar () {
  const dir = dirProyectos()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const meta = leerJson(path.join(dir, d.name, 'meta.json'), {})
      const estado = leerJson(path.join(dir, d.name, 'estado.json'), { fase: 'sin-ingest' })
      const coms = leerJson(path.join(dir, d.name, 'comentarios.json'), { items: [] })
      return {
        slug: d.name,
        titulo: meta.titulo || d.name,
        duracion: meta.duracion || 0,
        creado: meta.creado || null,
        fase: estado.fase,
        error: estado.error || null,
        progreso: estado.progreso || 0,
        comentarios: coms.items.length,
        abiertos: coms.items.filter(c => c.estado !== 'resuelto').length,
        entregas: entregas(d.name)
      }
    })
    .sort((a, b) => String(b.creado).localeCompare(String(a.creado)))
}

export function entregas (slug) {
  const dir = path.join(dirProyecto(slug), 'entregas')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({
      version: d.name,
      archivos: fs.readdirSync(path.join(dir, d.name)),
      nota: leerJson(path.join(dir, d.name, 'nota.json'), null),
      plan: leerJson(path.join(dir, d.name, 'clips.json'), null)
    }))
    .sort((a, b) => a.version.localeCompare(b.version))
}

export function crear ({ titulo, videoPath }) {
  if (!videoPath) throw new Error('Falta la ruta del video')
  const limpio = videoPath.trim().replace(/^["']|["']$/g, '').trim()
  if (!fs.existsSync(limpio)) throw new Error(`No existe esa ruta: ${limpio}`)
  if (fs.statSync(limpio).isDirectory()) {
    const dentro = fs.readdirSync(limpio).filter(f => /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f))
    throw new Error(`Eso es una carpeta, no un video. Necesito la ruta del archivo.` +
      (dentro.length ? ` Videos que veo ahi: ${dentro.slice(0, 6).join(', ')}` : ' No veo videos dentro.'))
  }
  if (!/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(limpio)) {
    throw new Error(`No parece un video: ${path.basename(limpio)}`)
  }

  const base = slugify(titulo || path.parse(limpio).name)
  const fecha = new Date().toISOString().slice(0, 7)
  let slug = `${fecha}-${base}`
  let n = 2
  while (fs.existsSync(dirProyecto(slug))) slug = `${fecha}-${base}-${n++}`

  const dir = dirProyecto(slug)
  fs.mkdirSync(dir, { recursive: true })
  escribirJson(path.join(dir, 'meta.json'), {
    slug,
    titulo: titulo || path.parse(limpio).name,
    videoPath: limpio,          // ruta LOCAL, nunca se sube el binario
    creado: new Date().toISOString()
  })
  escribirJson(path.join(dir, 'comentarios.json'), { slug, items: [] })
  return slug
}

export function borrar (slug) {
  const dir = dirProyecto(slug)
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })   // solo los datos; el video no se toca
  return true
}

export function cargar (slug) {
  const dir = dirProyecto(slug)
  if (!fs.existsSync(dir)) return null
  const datos = { slug }
  for (const [clave, archivo] of Object.entries(ARCHIVOS)) {
    datos[clave] = leerJson(path.join(dir, archivo), null)
  }
  datos.estado = leerJson(path.join(dir, 'estado.json'), { fase: 'sin-ingest', progreso: 0 })
  datos.entregas = entregas(slug)
  return datos
}

function guardarComentarios (slug, doc) {
  escribirJson(path.join(dirProyecto(slug), 'comentarios.json'), doc)
  return doc
}

export function agregarComentario (slug, c) {
  const f = path.join(dirProyecto(slug), 'comentarios.json')
  const doc = leerJson(f, { slug, items: [] })
  const id = 'c' + (doc.items.reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0) + 1)
  const nuevo = {
    id,
    t: Number(c.t) || 0,               // siempre en coordenadas del ORIGINAL
    tEnd: c.tEnd == null ? null : Number(c.tEnd),
    clip: c.clip ? String(c.clip) : null,   // si nacio sobre un clip, cual
    tipo: ['corte', 'subtitulo', 'grafico', 'nota'].includes(c.tipo) ? c.tipo : 'nota',
    texto: String(c.texto || '').trim(),
    estado: 'abierto',
    creado: new Date().toISOString()
  }
  doc.items.push(nuevo)
  doc.items.sort((a, b) => a.t - b.t)
  guardarComentarios(slug, doc)
  return nuevo
}

export function editarComentario (slug, id, parcial) {
  const f = path.join(dirProyecto(slug), 'comentarios.json')
  const doc = leerJson(f, { slug, items: [] })
  const i = doc.items.findIndex(x => x.id === id)
  if (i < 0) return null
  const permitido = ['texto', 'tipo', 'estado', 't', 'tEnd', 'clip']
  for (const k of permitido) if (k in parcial) doc.items[i][k] = parcial[k]
  doc.items.sort((a, b) => a.t - b.t)
  guardarComentarios(slug, doc)
  return doc.items[i]
}

export function borrarComentario (slug, id) {
  const f = path.join(dirProyecto(slug), 'comentarios.json')
  const doc = leerJson(f, { slug, items: [] })
  const antes = doc.items.length
  doc.items = doc.items.filter(x => x.id !== id)
  guardarComentarios(slug, doc)
  return antes !== doc.items.length
}
