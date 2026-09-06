import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { cfg, dirProyecto } from './config.js'
import { leerJson } from './util.js'
import { leerMeta } from './proyectos.js'
import { buscarNavegador } from './navegador.js'
import { dirRenders } from './render.js'

export const dirGraficos = (slug) => path.join(dirRenders(slug), 'graficos')

const FPS = 30

function correrFfmpeg (args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cfg.ffmpeg, args, { cwd, windowsHide: true })
    let err = ''
    p.stderr.on('data', d => { err += d })
    p.on('error', e => reject(new Error(`no se pudo ejecutar ffmpeg: ${e.message}`)))
    p.on('close', c => c === 0 ? resolve() : reject(new Error(err.split(/\r?\n/).filter(Boolean).slice(-2).join(' '))))
  })
}

/**
 * Captura un HTML animado fotograma a fotograma, con transparencia.
 *
 * No se graba en tiempo real a proposito: se fija el reloj de las animaciones a
 * cada instante exacto y se captura. Asi el resultado es identico en cualquier
 * maquina, por lenta que vaya, y reproducible entre iteraciones.
 */
export async function capturar (htmlPath, { ancho, alto, duracion, datos = {}, salidaDir, instante = null, alAvanzar }) {
  const ejecutable = buscarNavegador()
  if (!ejecutable) {
    throw new Error('No encuentro Chrome ni Edge. Instala uno, o pon la ruta en NAVEGADOR= dentro del .env')
  }
  fs.mkdirSync(salidaDir, { recursive: true })
  for (const f of fs.readdirSync(salidaDir).filter(x => x.endsWith('.png'))) {
    fs.unlinkSync(path.join(salidaDir, f))
  }

  const navegador = await puppeteer.launch({
    executablePath: ejecutable,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb',
      '--hide-scrollbars', '--allow-file-access-from-files']
  })
  try {
    const pagina = await navegador.newPage()
    await pagina.setViewport({ width: ancho, height: alto, deviceScaleFactor: 1 })
    // Los datos llegan como window.DATOS antes de que corra nada de la plantilla.
    await pagina.evaluateOnNewDocument((d) => { window.DATOS = d }, datos)
    await pagina.goto('file://' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' })
    await pagina.evaluate(() => document.fonts?.ready)

    // instante != null: un solo fotograma, para la vista previa.
    // Cuanto se mueve de verdad: capturar mas alla de eso es fotocopiar la
    // misma imagen. Un rotulo que se anima medio segundo no necesita 1600
    // capturas para durar 53 s.
    let capturar = duracion
    if (instante === null) {
      const finAnimacion = await pagina.evaluate(() => {
        if (typeof window.dibujar === 'function') return null   // reloj propio: hay que capturarlo todo
        const fines = document.getAnimations().map(a => {
          const t = a.effect?.getTiming?.() || {}
          const iter = t.iterations
          if (iter === Infinity) return Infinity
          const dur = typeof t.duration === 'number' ? t.duration : 0
          return (t.delay || 0) + dur * (iter || 1) + (t.endDelay || 0)
        })
        return fines.length ? Math.max(...fines) : 0
      })
      if (finAnimacion !== null && isFinite(finAnimacion)) {
        capturar = Math.min(duracion, finAnimacion / 1000 + 2 / FPS)
      }
    }
    const total = instante === null ? Math.max(1, Math.round(capturar * FPS)) : 1
    if (instante === null && capturar < duracion - 0.05) {
      console.log(`  [grafico] ${path.basename(htmlPath)}: ${total} capturas para ${capturar.toFixed(2)} s ` +
        `animados, el resto (${(duracion - capturar).toFixed(1)} s) se clona`)
    }
    for (let i = 0; i < total; i++) {
      const ms = instante === null ? (i / FPS) * 1000 : instante * 1000
      await pagina.evaluate((t) => {
        for (const a of document.getAnimations()) {
          try { a.pause(); a.currentTime = t } catch { /* animacion no seekable */ }
        }
        // Las plantillas pueden exponer su propio reloj para cosas que CSS no cubre.
        if (typeof window.dibujar === 'function') window.dibujar(t / 1000)
      }, ms)
      await pagina.screenshot({
        path: path.join(salidaDir, `f${String(i).padStart(5, '0')}.png`),
        omitBackground: true    // de aqui sale el canal alfa
      })
      // Capturar 180 fotogramas tarda un minuto: sin avisar, parece colgado.
      if (alAvanzar && i % 5 === 0) alAvanzar(((i + 1) / total) * 100)
    }
    return { total, capturado: instante === null ? capturar : 0 }
  } finally {
    await navegador.close()
  }
}

/**
 * PNG con alfa -> WebM con alfa. Se cachea: componerlo despues es instantaneo.
 * Si solo se capturo la parte animada, el ultimo fotograma se clona hasta
 * completar la duracion pedida.
 */
export async function empaquetar (dirFrames, destino, { capturado = 0, duracion = 0 } = {}) {
  const sobra = Math.max(0, duracion - capturado)
  const filtro = sobra > 0.05
    ? ['-vf', `tpad=stop_mode=clone:stop_duration=${sobra.toFixed(3)}`]
    : []
  await correrFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', String(FPS), '-i', 'f%05d.png',
    ...filtro,
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '28',
    '-auto-alt-ref', '0', destino
  ], dirFrames)
  for (const f of fs.readdirSync(dirFrames).filter(x => x.endsWith('.png'))) {
    fs.unlinkSync(path.join(dirFrames, f))   // los PNG pesan cientos de MB
  }
  return destino
}

export function leerPlanGraficos (slug, entrega) {
  return leerJson(path.join(dirProyecto(slug), 'entregas', entrega, 'graficos.json'), null)
}

/**
 * HTML de un grafico. Primero se busca junto a su entrega, y si no esta, entre
 * las plantillas de la app: los patrones que ya se repiten dejan de copiarse a
 * mano en cada proyecto, pero un proyecto siempre puede traer el suyo propio.
 */
export function htmlDe (slug, entrega, g) {
  const propio = path.join(dirProyecto(slug), 'entregas', entrega, 'graficos', g.archivo)
  if (fs.existsSync(propio)) return propio
  const plantilla = path.join(cfg.raizApp, 'plantillas', path.basename(g.archivo))
  return fs.existsSync(plantilla) ? plantilla : propio
}

/**
 * Archivos que el grafico referencia en sus datos (imagenes, videos, fuentes).
 * Se detectan por la extension: cualquier valor de texto que parezca un archivo.
 */
export function recursosDe (slug, entrega, g) {
  const dir = path.join(dirProyecto(slug), 'entregas', entrega, 'graficos')
  return Object.values(g.datos || {})
    .filter(v => typeof v === 'string' && /\.(jpe?g|png|webp|gif|svg|mp4|webm|woff2?|ttf|otf)$/i.test(v))
    .map(v => path.join(dir, path.basename(v)))
}

/** Los recursos que faltan. Un grafico al que le falta su imagen no se genera. */
export function faltanRecursos (slug, entrega, g) {
  return recursosDe(slug, entrega, g).filter(f => !fs.existsSync(f))
}

/**
 * Huella del grafico: si cambia, hay que regenerar.
 *
 * Antes solo se miraba la fecha del HTML, asi que corregir el nombre de una
 * imagen en graficos.json no invalidaba nada y se reutilizaba el WebM viejo.
 */
function huella (slug, entrega, g) {
  const html = htmlDe(slug, entrega, g)
  const partes = [
    fs.existsSync(html) ? String(fs.statSync(html).mtimeMs) : 'sin-html',
    JSON.stringify(g.datos || {}),
    `${g.ancho}x${g.alto}`,
    (g.out - g.in).toFixed(3)
  ]
  for (const f of recursosDe(slug, entrega, g)) {
    const st = fs.existsSync(f) ? fs.statSync(f) : null
    partes.push(`${path.basename(f)}:${st ? st.mtimeMs + ':' + st.size : 'falta'}`)
  }
  return partes.join('|')
}

/** Genera (o reutiliza) el WebM de un grafico. */
export async function generar (slug, entrega, g, { forzar = false, alAvanzar } = {}) {
  const dir = path.join(dirGraficos(slug), entrega, g.id)
  const destino = path.join(dirGraficos(slug), entrega, `${g.id}.webm`)
  const html = htmlDe(slug, entrega, g)
  if (!fs.existsSync(html)) throw new Error(`falta el HTML del gráfico: ${g.archivo}`)

  const marca = destino + '.huella'
  const actual = huella(slug, entrega, g)
  if (!forzar && fs.existsSync(destino) && fs.existsSync(marca) &&
      fs.readFileSync(marca, 'utf8') === actual) {
    return destino     // nada cambio desde la ultima vez
  }
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  const duracion = g.out - g.in
  const { capturado } = await capturar(html, {
    ancho: g.ancho, alto: g.alto, duracion,
    datos: g.datos || {}, salidaDir: dir, alAvanzar
  })
  await empaquetar(dir, destino, { capturado, duracion })
  fs.rmSync(dir, { recursive: true, force: true })
  fs.writeFileSync(marca, actual, 'utf8')
  return destino
}

/**
 * Vista previa barata: el grafico sobre un frame fijo del video, en PNG.
 * Iterar sobre una imagen de 2 segundos en vez de sobre un render completo.
 */
export async function previsualizar (slug, entrega, g, { fuente, tFuente, tAnim, filtroBase = null }) {
  const dir = path.join(dirGraficos(slug), entrega, `_prev_${g.id}`)
  const html = htmlDe(slug, entrega, g)
  if (!fs.existsSync(html)) throw new Error(`falta el HTML del gráfico: ${g.archivo}`)

  const dentro = Math.max(0, Math.min(Number(tAnim) || 0, g.out - g.in))
  await capturar(html, {
    ancho: g.ancho, alto: g.alto, duracion: 0, instante: dentro,
    datos: g.datos || {}, salidaDir: dir
  })
  const capa = path.join(dir, 'f00000.png')

  const destino = path.join(dirGraficos(slug), entrega, `_prev_${g.id}.png`)
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  // Si el clip aun no esta renderizado, montamos el mismo encuadre vertical que
  // tendra el clip. Recortar el original al centro daria una vista previa que no
  // se parece al resultado.
  const filtro = filtroBase
    ? `${filtroBase};[v][1:v]overlay=${g.x || 0}:${g.y || 0}`
    : `[0:v]scale=${g.ancho}:${g.alto}:force_original_aspect_ratio=increase,` +
      `crop=${g.ancho}:${g.alto}[base];[base][1:v]overlay=${g.x || 0}:${g.y || 0}`
  await correrFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(Math.max(0, tFuente)), '-i', fuente,
    '-i', capa, '-filter_complex', filtro, '-frames:v', '1', destino
  ], path.dirname(destino))
  fs.rmSync(dir, { recursive: true, force: true })
  return destino
}
