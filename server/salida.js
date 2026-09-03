// Analiza lo que producimos con la misma vara que la referencia.
// Sin esto se trabaja a ciegas sobre el propio trabajo: solo llegan las
// correcciones en texto, nunca la salida vista con los mismos ojos.
import fs from 'node:fs'
import path from 'node:path'
import { cfg, dirProyecto } from './config.js'
import { leerJson, escribirJson, correr } from './util.js'
import * as AN from './analisis.js'
import { dirRenders } from './render.js'
import { dirClips } from './clips.js'
import { dirReferencia } from './referencias.js'

export const dirAnalisis = (slug) => path.join(dirRenders(slug), 'analisis')

const enCurso = new Set()
export const analizando = (clave) => enCurso.has(clave)

export function leerAnalisis (slug, clave) {
  return leerJson(path.join(dirAnalisis(slug), `${clave}.json`), null)
}

export async function analizarClip (slug, entrega, id) {
  const clave = `${entrega}__${id}`
  if (enCurso.has(clave)) return { enCurso: true }
  const video = path.join(dirClips(slug), `${clave}.mp4`)
  if (!fs.existsSync(video)) throw new Error('ese clip no está renderizado todavía')

  enCurso.add(clave)
  try {
    const { out } = await correr(cfg.ffprobe, ['-v', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', video])
    const d = JSON.parse(out)
    const v = d.streams.find(s => s.codec_type === 'video') || {}
    const info = {
      ancho: v.width || 0, alto: v.height || 0,
      duracion: Number(d.format.duration || 0),
      relacion: v.width && v.height ? +(v.width / v.height).toFixed(4) : 0
    }

    const dHojas = path.join(dirAnalisis(slug), clave, 'hojas')
    const listaHojas = await AN.hojas(video, dHojas)
    const cortes = await AN.escenas(video)
    const audio = await AN.sonoridad(video)
    const col = await AN.color(video)
    const subs = await AN.medirSubtitulos(video, info).catch(() => null)

    // Palabras por cue las sacamos del tramo de la transcripcion del original
    // que cubre el clip, que es exactamente lo que se subtitulo.
    const plan = leerJson(path.join(dirProyecto(slug), 'entregas', entrega, 'clips.json'), null)
    const clip = (plan?.clips || []).find(c => c.id === id)
    const transcript = leerJson(path.join(dirProyecto(slug), 'transcript.json'), { segmentos: [] })
    const tramo = clip
      ? { segmentos: (transcript.segmentos || []).filter(s => s.out > clip.in && s.in < clip.out) }
      : transcript

    const medidas = {
      clave,
      formato: { ...info, vertical: info.relacion > 0 && info.relacion < 1 },
      ritmo: {
        cortes: cortes.length,
        planoMedio: cortes.length ? +(info.duracion / (cortes.length + 1)).toFixed(2) : +info.duracion.toFixed(2),
        instantes: cortes
      },
      habla: AN.ritmoDeHabla(tramo, info.duracion),
      subtitulos: subs,
      audio,
      color: col,
      imagenes: { hojas: listaHojas, fpsHoja: AN.HOJA.fps, columnas: AN.HOJA.cols, filas: AN.HOJA.filas },
      hecho: new Date().toISOString()
    }
    escribirJson(path.join(dirAnalisis(slug), `${clave}.json`), medidas)
    return medidas
  } finally {
    enCurso.delete(clave)
  }
}

const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null

/**
 * Comparacion numerica entre una referencia y una salida.
 * Cada fila lleva su tolerancia: sin eso todo parece distinto.
 */
export function comparar (medRef, medSalida) {
  const s = (o, ruta) => ruta.split('.').reduce((a, k) => (a == null ? a : a[k]), o)

  const FILAS = [
    { clave: 'subtitulos.desdeAbajo', etiqueta: 'altura del subtítulo (% desde abajo)', tol: 6 },
    { clave: 'subtitulos.altoLinea', etiqueta: 'alto de línea (% del alto)', tol: 1.2 },
    { clave: 'subtitulos.centroX', etiqueta: 'centro horizontal (%)', tol: 6 },
    { clave: 'subtitulos.anchoTexto', etiqueta: 'ancho del texto (%)', tol: 12 },
    { clave: 'subtitulos.lineas', etiqueta: 'líneas por cue', tol: 0.6 },
    { clave: 'ritmo.planoMedio', etiqueta: 'plano medio (s)', tol: 1.5 },
    { clave: 'habla.palabrasPorMinuto', etiqueta: 'palabras por minuto', tol: 30 },
    { clave: 'habla.palabrasPorSegmento', etiqueta: 'palabras por cue', tol: 1.5 },
    { clave: 'audio.lufs', etiqueta: 'sonoridad (LUFS)', tol: 2 },
    { clave: 'color.saturacionMedia', etiqueta: 'saturación media', tol: 20 },
    { clave: 'color.brilloMedio', etiqueta: 'brillo medio', tol: 20 }
  ]

  const filas = FILAS.map(f => {
    const a = num(s(medRef, f.clave))
    const b = num(s(medSalida, f.clave))
    if (a === null || b === null) return { ...f, referencia: a, salida: b, estado: 'sin dato' }
    const dif = +(b - a).toFixed(2)
    return { ...f, referencia: a, salida: b, diferencia: dif, estado: Math.abs(dif) <= f.tol ? 'ok' : 'corregir' }
  })

  const colores = [
    { etiqueta: 'color claro dominante del subtítulo', referencia: s(medRef, 'subtitulos.colorClaro'), salida: s(medSalida, 'subtitulos.colorClaro') },
    { etiqueta: 'color oscuro dominante del subtítulo', referencia: s(medRef, 'subtitulos.colorOscuro'), salida: s(medSalida, 'subtitulos.colorOscuro') }
  ]

  return {
    filas,
    colores,
    porCorregir: filas.filter(f => f.estado === 'corregir').length,
    // El algoritmo no distingue caja de contorno con fiabilidad: eso se lee de
    // los recortes a resolucion completa de la referencia.
    aOjo: 'caja o contorno, familia tipográfica y estilo de los gráficos se leen de los recortes, no de esta tabla'
  }
}

export function medidasReferencia (slugRef) {
  return leerJson(path.join(dirReferencia(slugRef), 'medidas.json'), null)
}
