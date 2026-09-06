// Revisa una entrega ANTES de renderizar.
// Casi todos los errores que hemos pillado viendo el video ya renderizado eran
// detectables aqui: cortes a media frase, imagenes que faltan, solapes.
import fs from 'node:fs'
import path from 'node:path'
import { dirProyecto } from './config.js'
import { leerJson } from './util.js'
import { leerMeta } from './proyectos.js'
import { leerPlanGraficos, faltanRecursos, htmlDe } from './graficos.js'

const cierraFrase = (p) => /[.?!]["»)]?$/.test(String(p).trim())

export function revisar (slug, entrega) {
  const dir = path.join(dirProyecto(slug), 'entregas', entrega)
  if (!fs.existsSync(dir)) throw new Error(`no existe la entrega ${entrega}`)

  const plan = leerJson(path.join(dir, 'clips.json'), null)
  if (!plan) throw new Error(`la entrega ${entrega} no tiene clips.json`)
  const transcript = leerJson(path.join(dirProyecto(slug), 'transcript.json'), { segmentos: [] })
  const planG = leerPlanGraficos(slug, entrega)
  const meta = leerMeta(slug) || {}
  const ws = (transcript.segmentos || []).flatMap(s => s.palabras || [])

  const avisos = []
  const anota = (nivel, donde, texto, arreglo) => avisos.push({ nivel, donde, texto, arreglo })

  const ids = new Set()
  for (const c of plan.clips || []) {
    const donde = c.titulo || c.id
    if (ids.has(c.id)) anota('error', donde, `el id ${c.id} está repetido`, 'renombra uno de los dos')
    ids.add(c.id)

    if (c.out - c.in < 5) anota('aviso', donde, `dura ${(c.out - c.in).toFixed(1)} s`, 'muy corto para publicarse solo')
    if (meta.duracion && c.out > meta.duracion) {
      anota('error', donde, `termina en ${c.out.toFixed(1)} s y el video dura ${meta.duracion.toFixed(1)}`, 'corrige el final')
    }

    if (ws.length) {
      const dentro = ws.filter(w => w.in >= c.in - 0.02 && w.out <= c.out + 0.02)
      const previa = ws.filter(w => w.out <= c.in + 0.02).pop()
      const siguiente = ws.find(w => w.in > c.out - 0.02)

      if (!dentro.length) {
        anota('error', donde, 'no cae ninguna palabra dentro del corte', 'revisa los tiempos')
      } else {
        // Empezar justo despues de una frase cerrada es lo correcto; si la
        // anterior quedo abierta y pegada, el clip arranca a media frase.
        if (previa && !cierraFrase(previa.p) && c.in - previa.out < 0.45) {
          anota('aviso', donde, `empieza a media frase, tras "${previa.p}"`,
            'mueve el inicio al comienzo de la frase')
        }
        const ultima = dentro[dentro.length - 1]
        if (!cierraFrase(ultima.p)) {
          anota('aviso', donde, `termina a media frase, en "${ultima.p}"`,
            'alarga hasta cerrar la idea')
        }
        if (siguiente && c.out > siguiente.in) {
          anota('error', donde, `se oye el arranque de "${siguiente.p}"`,
            `corta antes de ${siguiente.in.toFixed(2)} s`)
        }
      }
    }

    for (const x of c.insertos || []) {
      if (x.in < c.in || x.out > c.out) {
        anota('error', donde, `un inserto (${x.in}-${x.out}) se sale del clip`, 'ajusta la ventana')
      }
    }
  }

  const porClip = Object.fromEntries((plan.clips || []).map(c => [c.id, c]))
  for (const g of planG?.graficos || []) {
    const c = porClip[g.clip]
    const donde = `${c ? (c.titulo || c.id) : '?'} · ${g.id}`
    if (!c) {
      anota('error', donde, `apunta al clip ${g.clip}, que no existe en esta entrega`,
        'graficos.json y clips.json tienen que ir juntos')
      continue
    }
    if (g.in < c.in - 0.01 || g.out > c.out + 0.01) {
      anota('error', donde, 'se sale del clip', 'ajusta sus tiempos')
    }
    if (!fs.existsSync(htmlDe(slug, entrega, g))) {
      anota('error', donde, `falta el HTML ${g.archivo}`, 'ponlo en entregas/' + entrega + '/graficos/')
    }
    const faltan = faltanRecursos(slug, entrega, g)
    if (faltan.length) {
      anota('aviso', donde, `falta ${faltan.map(f => path.basename(f)).join(', ')}`,
        'el gráfico se omitirá al renderizar')
    }
    const dur = g.datos?.duracion
    if (typeof dur === 'number' && Math.abs(dur - (g.out - g.in)) > 0.1) {
      anota('aviso', donde, `datos.duracion es ${dur} pero la ventana dura ${(g.out - g.in).toFixed(2)}`,
        'la animación no cuadrará con el plano')
    }
    // Los insertos tapan la franja: un b-roll debajo no se veria.
    for (const x of c.insertos || []) {
      const solapa = g.in < x.out && g.out > x.in
      if (solapa && !g.id.startsWith('titulo')) {
        anota('aviso', donde, `se solapa con un inserto (${x.in}-${x.out})`,
          'el inserto lo tapa; mueve uno de los dos')
      }
    }
  }

  return {
    entrega,
    clips: (plan.clips || []).length,
    graficos: (planG?.graficos || []).length,
    errores: avisos.filter(a => a.nivel === 'error').length,
    avisos: avisos.filter(a => a.nivel === 'aviso').length,
    lista: avisos
  }
}
