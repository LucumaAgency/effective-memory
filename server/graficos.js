import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { cfg, dirProyecto } from './config.js'
import { leerJson } from './util.js'
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
export async function capturar (htmlPath, { ancho, alto, duracion, datos = {}, salidaDir, instante = null }) {
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
    const total = instante === null ? Math.max(1, Math.round(duracion * FPS)) : 1
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
    }
    return total
  } finally {
    await navegador.close()
  }
}

/** PNG con alfa -> WebM con alfa. Se cachea: componerlo despues es instantaneo. */
export async function empaquetar (dirFrames, destino) {
  await correrFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', String(FPS), '-i', 'f%05d.png',
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

/** Ruta del HTML de un grafico, que vive junto a su entrega. */
export function htmlDe (slug, entrega, g) {
  return path.join(dirProyecto(slug), 'entregas', entrega, 'graficos', g.archivo)
}

/** Genera (o reutiliza) el WebM de un grafico. */
export async function generar (slug, entrega, g, { forzar = false } = {}) {
  const dir = path.join(dirGraficos(slug), entrega, g.id)
  const destino = path.join(dirGraficos(slug), entrega, `${g.id}.webm`)
  const html = htmlDe(slug, entrega, g)
  if (!fs.existsSync(html)) throw new Error(`falta el HTML del gráfico: ${g.archivo}`)

  if (!forzar && fs.existsSync(destino) &&
      fs.statSync(destino).mtimeMs > fs.statSync(html).mtimeMs) {
    return destino     // el HTML no cambio desde la ultima vez
  }
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  await capturar(html, {
    ancho: g.ancho, alto: g.alto, duracion: g.out - g.in,
    datos: g.datos || {}, salidaDir: dir
  })
  await empaquetar(dir, destino)
  fs.rmSync(dir, { recursive: true, force: true })
  return destino
}

/**
 * Vista previa barata: el grafico sobre un frame fijo del video, en PNG.
 * Iterar sobre una imagen de 2 segundos en vez de sobre un render completo.
 */
export async function previsualizar (slug, entrega, g, { fuente, tFuente, tAnim }) {
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
  const filtro = `[0:v]scale=${g.ancho}:${g.alto}:force_original_aspect_ratio=increase,` +
    `crop=${g.ancho}:${g.alto}[base];[base][1:v]overlay=${g.x || 0}:${g.y || 0}`
  await correrFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(Math.max(0, tFuente)), '-i', fuente,
    '-i', capa, '-filter_complex', filtro, '-frames:v', '1', destino
  ], path.dirname(destino))
  fs.rmSync(dir, { recursive: true, force: true })
  return destino
}
