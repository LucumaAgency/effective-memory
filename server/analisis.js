import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { cfg } from './config.js'
import { correr } from './util.js'

export const HOJA = { fps: 2, cols: 6, filas: 5, ancho: 280 }

/** Hoja de contactos. Mismo formato para la referencia y para lo que producimos. */
export async function hojas (video, destino) {
  fs.rmSync(destino, { recursive: true, force: true })
  fs.mkdirSync(destino, { recursive: true })
  await correr(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', video,
    '-vf', `fps=${HOJA.fps},scale=${HOJA.ancho}:-2,tile=${HOJA.cols}x${HOJA.filas}:padding=6:margin=6:color=0x1a1a1a`,
    '-q:v', '4', path.join(destino, 'hoja%02d.jpg')])
  return fs.readdirSync(destino).filter(f => f.endsWith('.jpg')).sort()
}

/** Cambios de plano. La duracion media de plano es lo que mas define el ritmo. */
export async function escenas (video, umbral = 0.28) {
  let log = ''
  try {
    await correr(cfg.ffmpeg, ['-hide_banner', '-nostats', '-i', video,
      '-vf', `select='gt(scene,${umbral})',showinfo`, '-an', '-f', 'null', '-'],
    { onStderr: t => { log += t } })
  } catch (e) { log += e.err || '' }
  const t = [...log.matchAll(/pts_time:([\d.]+)/g)].map(m => +Number(m[1]).toFixed(3))
  return [...new Set(t)].sort((a, b) => a - b)
}

/** Sonoridad integrada: delata musica de fondo y a que nivel esta mezclada. */
export async function sonoridad (video) {
  let log = ''
  try {
    await correr(cfg.ffmpeg, ['-hide_banner', '-nostats', '-i', video,
      '-af', 'ebur128=peak=true', '-f', 'null', '-'], { onStderr: t => { log += t } })
  } catch (e) { log += e.err || '' }
  const resumen = log.split('Summary').pop() || ''
  const num = (etq) => {
    const m = new RegExp(`${etq}:\\s*(-?[\\d.]+)`).exec(resumen)
    return m ? Number(m[1]) : null
  }
  return { lufs: num('I'), rango: num('LRA'), picoReal: num('Peak') }
}

export async function color (video) {
  let log = ''
  try {
    await correr(cfg.ffmpeg, ['-hide_banner', '-nostats', '-i', video,
      '-vf', 'fps=1,scale=160:-2,signalstats,metadata=print', '-an', '-f', 'null', '-'],
    { onStderr: t => { log += t } })
  } catch (e) { log += e.err || '' }
  const media = (clave) => {
    const xs = [...log.matchAll(new RegExp(`lavfi\\.signalstats\\.${clave}=([\\d.]+)`, 'g'))].map(m => Number(m[1]))
    return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null
  }
  return { saturacionMedia: media('SATAVG'), brilloMedio: media('YAVG') }
}

/** Lee el video como fotogramas RGB crudos y pequenos, sin dependencias de imagen. */
function fotogramasCrudos (video, { ancho = 240, fps = 2 }) {
  return new Promise((resolve, reject) => {
    const p = spawn(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', video,
      '-vf', `fps=${fps},scale=${ancho}:-2`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { windowsHide: true })
    const trozos = []
    let err = ''
    p.stdout.on('data', d => trozos.push(d))
    p.stderr.on('data', d => { err += d })
    p.on('error', e => reject(new Error(`no se pudo ejecutar ffmpeg: ${e.message}`)))
    p.on('close', c => c === 0 ? resolve(Buffer.concat(trozos)) : reject(new Error(err.slice(-400))))
  })
}

/**
 * Mide el subtitulo mirando los pixeles, no adivinando.
 *
 * El texto se delata por el contraste local: un borde blanco sobre oscuro (o con
 * contorno) produce muchisimos saltos de luminancia por fila. Buscamos la franja
 * de la mitad inferior donde esa densidad se dispara.
 *
 * Es una estimacion, no una lectura exacta: se etiqueta como tal.
 */
export async function medirSubtitulos (video, { ancho, alto }) {
  const A = 240
  const H = Math.max(2, Math.round(alto / ancho * A / 2) * 2)
  const datos = await fotogramasCrudos(video, { ancho: A, fps: 2 })
  const porFrame = A * H * 3
  const total = Math.floor(datos.length / porFrame)
  if (!total) return null

  const densidadFila = new Float64Array(H)
  const densidadCol = new Float64Array(A)
  const UMBRAL = 60          // salto de luminancia que cuenta como borde de texto

  for (let f = 0; f < total; f++) {
    const base = f * porFrame
    for (let y = 0; y < H; y++) {
      let bordes = 0
      for (let x = 1; x < A; x++) {
        const i = base + (y * A + x) * 3
        const j = i - 3
        const l1 = (datos[i] * 299 + datos[i + 1] * 587 + datos[i + 2] * 114) / 1000
        const l0 = (datos[j] * 299 + datos[j + 1] * 587 + datos[j + 2] * 114) / 1000
        if (Math.abs(l1 - l0) > UMBRAL) bordes++
      }
      densidadFila[y] += bordes
    }
  }

  // La franja de texto se busca solo en la mitad inferior: arriba suele haber
  // titulos o interfaz que confundirian la medida.
  const desde = Math.floor(H * 0.45)
  const medias = Array.from(densidadFila, v => v / total)
  const pico = Math.max(...medias.slice(desde))
  if (pico < 3) return { detectado: false }

  // Umbral bajo a proposito: con 0.35 se recortaba el trazo y el alto de linea
  // salia casi la mitad del real.
  const corte = pico * 0.15
  let arriba = -1, abajo = -1
  for (let y = desde; y < H; y++) {
    if (medias[y] >= corte) { if (arriba < 0) arriba = y; abajo = y }
  }
  if (arriba < 0) return { detectado: false }

  // La densidad por columna se calcula SOLO dentro de la franja. Hacerlo sobre
  // todo el fotograma dejaba que el fondo la dominara y el ancho salia absurdo.
  for (let f = 0; f < total; f++) {
    const base = f * porFrame
    for (let y = arriba; y <= abajo; y++) {
      for (let x = 1; x < A; x++) {
        const i = base + (y * A + x) * 3
        const j = i - 3
        const l1 = (datos[i] * 299 + datos[i + 1] * 587 + datos[i + 2] * 114) / 1000
        const l0 = (datos[j] * 299 + datos[j + 1] * 587 + datos[j + 2] * 114) / 1000
        if (Math.abs(l1 - l0) > UMBRAL) densidadCol[x] += 1
      }
    }
  }

  const colsMedias = Array.from(densidadCol, v => v / total)
  const picoCol = Math.max(...colsMedias)
  let izq = -1, der = -1
  for (let x = 0; x < A; x++) {
    if (colsMedias[x] >= picoCol * 0.25) { if (izq < 0) izq = x; der = x }
  }

  // Alto de una linea: los huecos dentro de la franja separan lineas.
  let lineas = 0, dentro = false
  for (let y = arriba; y <= abajo; y++) {
    const activo = medias[y] >= corte
    if (activo && !dentro) lineas++
    dentro = activo
  }

  // Color: la MODA de los pixeles pegados a un borde, no la media. Promediar
  // sobre un fondo variado da barro; la moda se queda con el relleno.
  // Se recogen dos modas, la clara y la oscura, para poder distinguir
  // "texto claro con contorno" de "texto oscuro sobre caja clara".
  const cubos = new Map()
  const cubosOscuros = new Map()
  let pixelesBanda = 0, pixelesClaros = 0
  let lisoSuma = 0, lisoN = 0     // pixeles SIN borde cerca: fondo o caja
  for (let f = 0; f < total; f++) {
    const base = f * porFrame
    for (let y = arriba; y <= abajo; y++) {
      // Solo dentro del ancho real del texto: contar los margenes vacios diluia
      // la proporcion y hacia indistinguible una caja de un texto suelto.
      for (let x = Math.max(1, izq); x <= Math.min(der, A - 2); x++) {
        const i = base + (y * A + x) * 3
        const l = (datos[i] * 299 + datos[i + 1] * 587 + datos[i + 2] * 114) / 1000
        pixelesBanda++
        if (l >= 150) pixelesClaros++
        // Solo pixeles pegados a un borde: un trazo de letra siempre lo esta,
        // un fondo plano (aunque sea claro y enorme) no.
        let pegado = false
        for (let d = -2; d <= 2 && !pegado; d++) {
          const a = x + d, b = a + 1
          if (a < 0 || b >= A) continue
          const ia = base + (y * A + a) * 3, ib = base + (y * A + b) * 3
          const la = (datos[ia] * 299 + datos[ia + 1] * 587 + datos[ia + 2] * 114) / 1000
          const lb = (datos[ib] * 299 + datos[ib + 1] * 587 + datos[ib + 2] * 114) / 1000
          if (Math.abs(lb - la) > UMBRAL) pegado = true
        }
        if (!pegado) { lisoSuma += l; lisoN++; continue }
        const clave = (datos[i] >> 5 << 10) | (datos[i + 1] >> 5 << 5) | (datos[i + 2] >> 5)
        const donde = l >= 150 ? cubos : cubosOscuros
        const c = donde.get(clave) || { r: 0, g: 0, b: 0, n: 0 }
        c.r += datos[i]; c.g += datos[i + 1]; c.b += datos[i + 2]; c.n++
        donde.set(clave, c)
      }
    }
  }
  const moda = (m) => { let d = null; for (const c of m.values()) if (!d || c.n > d.n) d = c; return d }
  const claro = moda(cubos)
  const oscuro = moda(cubosOscuros)
  const hex = (c) => c
    ? '#' + [c.r, c.g, c.b].map(v => Math.round(v / c.n).toString(16).padStart(2, '0')).join('').toUpperCase()
    : null

  // No se decide aqui si hay caja o contorno: probamos varios criterios de pixel
  // y ninguno separa los dos casos con fiabilidad. Eso se lee del recorte a
  // resolucion completa, que es justo para lo que existe. Aqui se reportan los
  // dos colores dominantes y el brillo del entorno, y la lectura se hace mirando.
  const proporcionClara = pixelesBanda ? pixelesClaros / pixelesBanda : 0
  const brilloLiso = lisoN ? lisoSuma / lisoN : 0

  const pct = (v, ref) => +(v / ref * 100).toFixed(1)
  const alturaFranja = abajo - arriba + 1

  // Una franja que ocupa media pantalla no es un subtitulo, es una imagen movida.
  if (alturaFranja / H > 0.25) {
    return { detectado: false, motivo: 'la franja de contraste ocupa demasiada altura; probablemente no hay subtitulo quemado' }
  }

  return {
    detectado: true,
    estimado: true,
    // Distancia del borde inferior del texto al fondo del cuadro: es como se
    // describe la posicion de un subtitulo, no desde arriba.
    desdeAbajo: pct(H - 1 - abajo, H),
    bandaSuperior: pct(arriba, H),
    lineas: Math.max(1, lineas),
    altoLinea: +(alturaFranja / Math.max(1, lineas) / H * 100).toFixed(1),
    centroX: pct((izq + der) / 2, A),
    anchoTexto: pct(der - izq + 1, A),
    colorClaro: hex(claro),
    colorOscuro: hex(oscuro),
    proporcionClara: +proporcionClara.toFixed(2),
    brilloAlrededor: Math.round(brilloLiso)
  }
}


/** Palabras por cue y por minuto, desde una transcripcion ya hecha. */
export function ritmoDeHabla (transcript, duracion) {
  const segs = transcript?.segmentos || []
  const palabras = segs.reduce((s, x) => s + (x.palabras?.length || 0), 0)
  return {
    palabras,
    palabrasPorMinuto: duracion ? Math.round(palabras / duracion * 60) : 0,
    palabrasPorSegmento: segs.length ? +(palabras / segs.length).toFixed(1) : 0
  }
}
