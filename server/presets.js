// Un preset guarda el "look" de un proyecto: encuadre, maqueta, estilo de
// subtitulos y valores por defecto de los graficos. Sirve para que el segundo
// video de una serie no se arme copiando a mano lo del primero, que es donde
// se pierden los detalles.
import fs from 'node:fs'
import path from 'node:path'
import { cfg, dirProyecto } from './config.js'
import { leerJson, escribirJson, slugify } from './util.js'

export const dirPresets = () => path.join(cfg.dataRepo, 'presets')

export function listar () {
  const dir = dirPresets()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    const d = leerJson(path.join(dir, f), {})
    return { nombre: f.replace(/\.json$/, ''), titulo: d.titulo || f, creado: d.creado || null }
  })
}

/** Extrae de una entrega lo que se repite entre videos. */
export function guardar (slug, entrega, nombre) {
  const plan = leerJson(path.join(dirProyecto(slug), 'entregas', entrega, 'clips.json'), null)
  if (!plan) throw new Error(`la entrega ${entrega} no tiene clips.json`)
  const g = leerJson(path.join(dirProyecto(slug), 'entregas', entrega, 'graficos.json'), null)

  // Se guarda lo estructural, nunca los tiempos ni los textos: eso es del video.
  const preset = {
    titulo: nombre,
    creado: new Date().toISOString(),
    origen: `${slug}/${entrega}`,
    formato: plan.formato || null,
    fuente: plan.fuente || null,
    estilo: plan.estilo || null,
    subtitulos: plan.subtitulos ?? null,
    porClip: (() => {
      const c = (plan.clips || [])[0] || {}
      return { formato: c.formato || null, fuente: c.fuente || null, estilo: c.estilo || null }
    })(),
    maqueta: g?.maqueta || null,
    graficos: (g?.graficos || []).map(x => ({
      archivo: x.archivo, x: x.x, y: x.y, ancho: x.ancho, alto: x.alto,
      datos: Object.fromEntries(Object.entries(x.datos || {})
        .filter(([k]) => !['texto', 'archivo', 'duracion', 'numero', 'credito'].includes(k)))
    })).filter((x, i, a) => a.findIndex(y => y.archivo === x.archivo && y.y === x.y) === i)
  }
  const archivo = path.join(dirPresets(), `${slugify(nombre)}.json`)
  escribirJson(archivo, preset)
  return { nombre: slugify(nombre), archivo }
}

/** Aplica un preset a una entrega: encuadre y estilo, sin tocar tiempos ni textos. */
export function aplicar (slug, entrega, nombre) {
  const preset = leerJson(path.join(dirPresets(), `${nombre}.json`), null)
  if (!preset) throw new Error(`no existe el preset ${nombre}`)
  const f = path.join(dirProyecto(slug), 'entregas', entrega, 'clips.json')
  const plan = leerJson(f, null)
  if (!plan) throw new Error(`la entrega ${entrega} no tiene clips.json`)

  for (const k of ['formato', 'fuente', 'estilo']) if (preset[k]) plan[k] = preset[k]
  if (preset.subtitulos !== null) plan.subtitulos = preset.subtitulos
  for (const c of plan.clips || []) {
    for (const k of ['formato', 'fuente', 'estilo']) {
      if (preset.porClip?.[k]) c[k] = JSON.parse(JSON.stringify(preset.porClip[k]))
    }
  }
  escribirJson(f, plan)
  return { aplicado: nombre, clips: (plan.clips || []).length }
}
