import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { cfg, RAIZ, dirProyecto, dirProyectos } from './config.js'
import * as P from './proyectos.js'
import { lanzarIngest, estadoIngest, frameEn, detectarSilencios } from './ingest.js'
import * as G from './git.js'
import * as R from './render.js'
import * as C from './clips.js'
import * as X from './cortes.js'
import * as GR from './graficos.js'
import { buscarNavegador } from './navegador.js'
import { leerJson } from './util.js'

const app = express()
app.use(express.json({ limit: '2mb' }))
app.use(express.static(path.join(RAIZ, 'web')))

const ok = (fn) => async (req, res) => {
  try {
    await fn(req, res)
  } catch (e) {
    console.error(`[${req.method} ${req.path}]`, e.message)
    if (res.headersSent) return res.destroy()
    res.status(400).json({ error: e.message })
  }
}

// Un stream roto (archivo movido, pestana cerrada a medias) no debe tumbar el server.
const enviarStream = (res, stream) => {
  stream.on('error', e => {
    console.error('[stream]', e.message)
    res.headersSent ? res.destroy() : res.status(500).end()
  })
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}
const metaDe = (slug) => leerJson(path.join(dirProyecto(slug), 'meta.json'))

app.get('/favicon.ico', (_req, res) => {
  res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#4f7cff"/><path d="M6 4.5l5 3.5-5 3.5z" fill="#fff"/></svg>')
})

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

app.delete('/api/proyectos/:slug', ok(async (req, res) => {
  res.json({ borrado: P.borrar(req.params.slug) })
}))

app.get('/api/proyectos/:slug/estado', ok(async (req, res) => res.json(estadoIngest(req.params.slug))))

app.post('/api/proyectos/:slug/ingest', ok(async (req, res) => res.json(lanzarIngest(req.params.slug))))

// Video servido desde el disco local, con soporte de Range para que el seek sea inmediato.
function servirVideo (req, res, archivo) {
  if (!archivo || !fs.existsSync(archivo)) return res.status(404).end()
  const st = fs.statSync(archivo)
  if (!st.isFile()) return res.status(400).json({ error: 'esa ruta no es un archivo' })
  const total = st.size
  const tipo = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' }[path.extname(archivo).toLowerCase()] || 'video/mp4'
  const rango = req.headers.range

  if (!rango) {
    res.writeHead(200, { 'Content-Length': total, 'Content-Type': tipo, 'Accept-Ranges': 'bytes' })
    return enviarStream(res, fs.createReadStream(archivo))
  }
  const m = /bytes=(\d*)-(\d*)/.exec(rango)
  if (!m) return res.status(416).end()
  const desde = m[1] ? Number(m[1]) : 0
  const hasta = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1
  res.writeHead(206, {
    'Content-Range': `bytes ${desde}-${hasta}/${total}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': hasta - desde + 1,
    'Content-Type': tipo
  })
  enviarStream(res, fs.createReadStream(archivo, { start: desde, end: hasta }))
}

app.get('/api/proyectos/:slug/video', ok(async (req, res) => {
  servirVideo(req, res, metaDe(req.params.slug)?.videoPath)
}))

// --- previews renderizadas ---
app.post('/api/proyectos/:slug/render', ok(async (req, res) => {
  res.json(R.renderizar(req.params.slug, req.body || {}))
}))
app.get('/api/proyectos/:slug/render/estado', ok(async (req, res) => {
  res.json({ ...R.estadoRender(req.params.slug), renders: R.listarRenders(req.params.slug) })
}))
// --- graficos ---
// Vista previa barata: el grafico sobre un frame fijo, en PNG. Iterar sobre una
// imagen de dos segundos en vez de sobre un render completo.
app.get('/api/proyectos/:slug/graficos/preview', ok(async (req, res) => {
  const { slug } = req.params
  const { entrega, id } = req.query
  const plan = GR.leerPlanGraficos(slug, entrega)
  const g = (plan?.graficos || []).find(x => x.id === id)
  if (!g) return res.status(404).json({ error: 'gráfico no encontrado' })

  const meta = metaDe(slug)
  const tAnim = req.query.t == null ? Math.min(0.8, (g.out - g.in) / 2) : Number(req.query.t)

  // Si el clip ya esta renderizado usamos ese como fondo: es exactamente lo que se vera.
  // Si no, aplicamos su mismo encuadre vertical sobre el original.
  const planClips = C.leerPlan(slug, entrega)
  const clip = (planClips?.clips || []).find(c => c.id === g.clip)
  const renderClip = path.join(C.dirClips(slug), `${entrega}__${g.clip}.mp4`)
  const usarClip = clip && fs.existsSync(renderClip)

  const png = await GR.previsualizar(slug, entrega, g, {
    fuente: usarClip ? renderClip : meta.videoPath,
    tFuente: usarClip ? (g.in - clip.in + tAnim) : (g.in + tAnim),
    tAnim,
    filtroBase: usarClip || !clip ? null : C.construirFiltro(planClips, clip)
  })
  res.set('Cache-Control', 'no-store').sendFile(png)
}))

app.get('/api/proyectos/:slug/graficos', ok(async (req, res) => {
  const plan = GR.leerPlanGraficos(req.params.slug, req.query.entrega)
  res.json({ graficos: plan?.graficos || [], navegador: buscarNavegador() })
}))

// --- cortes de silencio ---
app.post('/api/proyectos/:slug/cortes', ok(async (req, res) => {
  res.json(X.aplicarCortes(req.params.slug, req.body || {}))
}))
app.get('/api/proyectos/:slug/cortes/estado', ok(async (req, res) => {
  res.json({ ...X.estadoCortes(req.params.slug), hechos: X.listarCortes(req.params.slug) })
}))
app.get('/api/proyectos/:slug/cortes/video', ok(async (req, res) => {
  servirVideo(req, res, path.join(X.dirCortes(req.params.slug), path.basename(req.query.archivo || '')))
}))

// Recalcular silencios con otro umbral, sin rehacer el ingest entero.
app.post('/api/proyectos/:slug/silencios', ok(async (req, res) => {
  const meta = metaDe(req.params.slug)
  if (!meta) return res.status(404).json({ error: 'proyecto no encontrado' })
  const datos = await detectarSilencios(meta.videoPath, {
    umbralDb: Number(req.body?.umbralDb),
    duracionMin: Number(req.body?.duracionMin)
  })
  fs.writeFileSync(path.join(dirProyecto(req.params.slug), 'silencios.json'),
    JSON.stringify(datos, null, 2) + '\n', 'utf8')
  res.json({
    ...datos,
    tramos: datos.tramos.length,
    segundos: +datos.tramos.reduce((s, t) => s + t.dur, 0).toFixed(1)
  })
}))

// --- clips verticales ---
app.post('/api/proyectos/:slug/clips', ok(async (req, res) => {
  res.json(C.renderizarClips(req.params.slug, req.body || {}))
}))
app.get('/api/proyectos/:slug/clips/estado', ok(async (req, res) => {
  res.json({ ...C.estadoClips(req.params.slug), hechos: C.listarClipsRenderizados(req.params.slug) })
}))
app.get('/api/proyectos/:slug/clips/video', ok(async (req, res) => {
  servirVideo(req, res, path.join(C.dirClips(req.params.slug), path.basename(req.query.archivo || '')))
}))

app.get('/api/proyectos/:slug/render/video', ok(async (req, res) => {
  servirVideo(req, res, path.join(R.dirRenders(req.params.slug), path.basename(req.query.archivo || '')))
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

// Red de seguridad: preferimos registrar y seguir vivos antes que morir a media edicion.
process.on('uncaughtException', e => console.error('[no capturado]', e))
process.on('unhandledRejection', e => console.error('[promesa no capturada]', e))

app.listen(cfg.puerto, () => {
  console.log(`\n  video-review  ->  http://localhost:${cfg.puerto}`)
  console.log(`  datos:          ${cfg.dataRepo}\n`)
})
