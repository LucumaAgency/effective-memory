import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { cfg, RAIZ, dirProyecto, dirProyectos } from './config.js'
import * as P from './proyectos.js'
import { lanzarIngest, estadoIngest, frameEn } from './ingest.js'
import * as G from './git.js'
import { leerJson } from './util.js'

const app = express()
app.use(express.json({ limit: '2mb' }))
app.use(express.static(path.join(RAIZ, 'web')))

const ok = (fn) => async (req, res) => {
  try { await fn(req, res) } catch (e) { res.status(400).json({ error: e.message }) }
}
const metaDe = (slug) => leerJson(path.join(dirProyecto(slug), 'meta.json'))

app.get('/api/salud', ok(async (_req, res) => {
  res.json({
    dataRepo: cfg.dataRepo,
    existeDataRepo: fs.existsSync(dirProyectos()) || fs.existsSync(cfg.dataRepo),
    git: await G.estadoRepo()
  })
}))

app.get('/api/proyectos', ok(async (_req, res) => res.json(P.listar())))

app.post('/api/proyectos', ok(async (req, res) => {
  const slug = P.crear(req.body)
  lanzarIngest(slug)
  res.json({ slug })
}))

app.get('/api/proyectos/:slug', ok(async (req, res) => {
  const d = P.cargar(req.params.slug)
  if (!d) return res.status(404).json({ error: 'proyecto no encontrado' })
  res.json(d)
}))

app.get('/api/proyectos/:slug/estado', ok(async (req, res) => res.json(estadoIngest(req.params.slug))))

app.post('/api/proyectos/:slug/ingest', ok(async (req, res) => res.json(lanzarIngest(req.params.slug))))

// Video servido desde el disco local, con soporte de Range para que el seek sea inmediato.
app.get('/api/proyectos/:slug/video', ok(async (req, res) => {
  const meta = metaDe(req.params.slug)
  if (!meta || !fs.existsSync(meta.videoPath)) return res.status(404).end()
  const total = fs.statSync(meta.videoPath).size
  const tipo = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' }[path.extname(meta.videoPath).toLowerCase()] || 'video/mp4'
  const rango = req.headers.range

  if (!rango) {
    res.writeHead(200, { 'Content-Length': total, 'Content-Type': tipo, 'Accept-Ranges': 'bytes' })
    return fs.createReadStream(meta.videoPath).pipe(res)
  }
  const m = /bytes=(\d*)-(\d*)/.exec(rango)
  const desde = m[1] ? Number(m[1]) : 0
  const hasta = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1
  res.writeHead(206, {
    'Content-Range': `bytes ${desde}-${hasta}/${total}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': hasta - desde + 1,
    'Content-Type': tipo
  })
  fs.createReadStream(meta.videoPath, { start: desde, end: hasta }).pipe(res)
}))

// Frames del muestreo grueso.
app.get('/api/proyectos/:slug/frames/:archivo', ok(async (req, res) => {
  const f = path.join(dirProyecto(req.params.slug), 'frames', path.basename(req.params.archivo))
  if (!fs.existsSync(f)) return res.status(404).end()
  res.sendFile(f)
}))

// Frame exacto bajo demanda (lo uso yo para mirar un momento puntual).
app.get('/api/proyectos/:slug/frame', ok(async (req, res) => {
  const meta = metaDe(req.params.slug)
  if (!meta) return res.status(404).end()
  const t = Math.max(0, Number(req.query.t) || 0)
  res.sendFile(await frameEn(req.params.slug, t, meta.videoPath))
}))

app.post('/api/proyectos/:slug/comentarios', ok(async (req, res) => res.json(P.agregarComentario(req.params.slug, req.body))))
app.patch('/api/proyectos/:slug/comentarios/:id', ok(async (req, res) => {
  const r = P.editarComentario(req.params.slug, req.params.id, req.body)
  r ? res.json(r) : res.status(404).json({ error: 'comentario no encontrado' })
}))
app.delete('/api/proyectos/:slug/comentarios/:id', ok(async (req, res) => {
  res.json({ borrado: P.borrarComentario(req.params.slug, req.params.id) })
}))

// Boton "Pedir revision"
app.post('/api/proyectos/:slug/pedir-revision', ok(async (req, res) => {
  const abiertos = (P.cargar(req.params.slug)?.comentarios?.items || []).filter(c => c.estado !== 'resuelto').length
  res.json(await G.empujar(req.params.slug, `revision: ${req.params.slug} (${abiertos} comentarios abiertos)`))
}))

// Boton "Traer entrega"
app.post('/api/traer', ok(async (_req, res) => res.json(await G.traer())))

app.listen(cfg.puerto, () => {
  console.log(`\n  video-review  ->  http://localhost:${cfg.puerto}`)
  console.log(`  datos:          ${cfg.dataRepo}\n`)
})
