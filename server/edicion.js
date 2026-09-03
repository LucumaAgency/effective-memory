// Escrituras que vienen de la timeline. Todo acaba en los mismos JSON de la
// entrega: si la interfaz tuviera su propio estado, el ida y vuelta con Claude
// dejaria de funcionar.
import fs from 'node:fs'
import path from 'node:path'
import { cfg, dirProyecto } from './config.js'
import { correr, leerJson, escribirJson } from './util.js'
import { dirRenders } from './render.js'

const archivoEntrega = (slug, entrega, nombre) =>
  path.join(dirProyecto(slug), 'entregas', entrega, nombre)

function ajustar (v, min, max) {
  return Math.max(min, Math.min(max, +Number(v).toFixed(3)))
}

export function editarClip (slug, entrega, id, cambios) {
  const f = archivoEntrega(slug, entrega, 'clips.json')
  const plan = leerJson(f, null)
  if (!plan) throw new Error(`la entrega ${entrega} no tiene clips.json`)
  const c = (plan.clips || []).find(x => x.id === id)
  if (!c) throw new Error(`no existe el clip ${id}`)

  const meta = leerJson(path.join(dirProyecto(slug), 'meta.json'), {})
  const dur = meta.duracion || 1e9
  if (cambios.in != null) c.in = ajustar(cambios.in, 0, dur - 0.3)
  if (cambios.out != null) c.out = ajustar(cambios.out, 0.3, dur)
  if (c.out - c.in < 0.5) throw new Error('el clip quedaría por debajo de medio segundo')
  if (cambios.titulo != null) c.titulo = String(cambios.titulo).slice(0, 120)

  c.editadoAMano = new Date().toISOString()   // marca para no pisarlo en la proxima entrega
  escribirJson(f, plan)
  return c
}

export function editarGrafico (slug, entrega, id, cambios) {
  const f = archivoEntrega(slug, entrega, 'graficos.json')
  const plan = leerJson(f, null)
  if (!plan) throw new Error(`la entrega ${entrega} no tiene graficos.json`)
  const g = (plan.graficos || []).find(x => x.id === id)
  if (!g) throw new Error(`no existe el gráfico ${id}`)

  const meta = leerJson(path.join(dirProyecto(slug), 'meta.json'), {})
  const dur = meta.duracion || 1e9
  if (cambios.in != null) g.in = ajustar(cambios.in, 0, dur - 0.2)
  if (cambios.out != null) g.out = ajustar(cambios.out, 0.2, dur)
  if (g.out - g.in < 0.3) throw new Error('el gráfico quedaría por debajo de 0.3 s')
  for (const k of ['x', 'y']) if (cambios[k] != null) g[k] = Math.round(Number(cambios[k]))

  g.editadoAMano = new Date().toISOString()
  escribirJson(f, plan)
  return g
}

/** HTML del grafico con sus datos ya inyectados, para verlo en un iframe. */
export function htmlGrafico (slug, entrega, id) {
  const plan = leerJson(archivoEntrega(slug, entrega, 'graficos.json'), null)
  const g = (plan?.graficos || []).find(x => x.id === id)
  if (!g) throw new Error('gráfico no encontrado')
  const f = path.join(dirProyecto(slug), 'entregas', entrega, 'graficos', g.archivo)
  if (!fs.existsSync(f)) throw new Error(`falta el HTML: ${g.archivo}`)

  // Mismo contrato que en la captura: window.DATOS antes de que corra nada.
  const inyeccion = `<script>window.DATOS=${JSON.stringify(g.datos || {})}</script>\n`
  return { html: inyeccion + fs.readFileSync(f, 'utf8'), grafico: g }
}

/** Forma de onda del audio, cacheada. Hace legible la timeline de un golpe. */
export async function formaDeOnda (slug) {
  const meta = leerJson(path.join(dirProyecto(slug), 'meta.json'), null)
  if (!meta || !fs.existsSync(meta.videoPath)) throw new Error('no encuentro el video')
  const destino = path.join(dirRenders(slug), 'onda.png')
  if (fs.existsSync(destino) &&
      fs.statSync(destino).mtimeMs > fs.statSync(meta.videoPath).mtimeMs) return destino

  fs.mkdirSync(path.dirname(destino), { recursive: true })
  await correr(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', meta.videoPath,
    '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=2400x100:colors=0x4f7cff',
    '-frames:v', '1', destino])
  return destino
}
