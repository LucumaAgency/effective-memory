import { cfg } from './config.js'
import { correr } from './util.js'

const git = (args) => correr('git', args, { cwd: cfg.dataRepo })

export async function estadoRepo () {
  try {
    const { out: rama } = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const { out: sucio } = await git(['status', '--porcelain'])
    let atras = 0
    try {
      await git(['fetch', '--quiet', 'origin', rama.trim()])
      const { out } = await git(['rev-list', '--count', 'HEAD..FETCH_HEAD'])
      atras = Number(out.trim()) || 0
    } catch { /* sin remoto o sin red */ }
    return {
      ok: true,
      rama: rama.trim(),
      pendientes: sucio.trim() ? sucio.trim().split(/\r?\n/).length : 0,
      entregasNuevas: atras
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// Boton "Pedir revision": sube todo lo del proyecto.
export async function empujar (slug, mensaje) {
  const rama = await ramaActual()
  await git(['add', '--all', '.'])
  const { out } = await git(['status', '--porcelain'])
  if (out.trim()) {
    await git(['commit', '-m', mensaje || `revision: ${slug}`])
  }
  await git(['push', 'origin', rama])
  const { out: sha } = await git(['rev-parse', '--short', 'HEAD'])
  return { commit: sha.trim(), sinCambios: !out.trim() }
}

async function ramaActual () {
  const { out } = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const r = out.trim()
  if (r === 'HEAD') throw new Error('el repo de datos esta en HEAD desacoplado; corre: git checkout main')
  return r
}

// Boton "Traer entrega".
// Deliberadamente NO usamos "git pull": su resolucion de que fusionar depende de
// la configuracion de tracking del clon y falla con "cannot fast-forward to
// multiple branches" cuando esa configuracion apunta a mas de una rama.
// fetch + merge FETCH_HEAD nombra exactamente un commit y no deja lugar a dudas.
export async function traer () {
  const rama = await ramaActual()
  try {
    await git(['fetch', 'origin', rama])
    const { out: antes } = await git(['rev-parse', 'HEAD'])
    const { out: remoto } = await git(['rev-parse', 'FETCH_HEAD'])
    if (antes.trim() === remoto.trim()) return { salida: 'Ya estabas al dia.', rama }
    const { out } = await git(['merge', '--ff-only', 'FETCH_HEAD'])
    return { salida: out.trim() || 'Actualizado.', rama }
  } catch (e) {
    if (/diverge|non-fast-forward|not possible to fast-forward|refusing to merge/i.test(e.message)) {
      throw new Error(`Tu copia de "${rama}" y la del servidor se separaron. ` +
        'Sube lo tuyo primero con "Pedir revision", o resuelvelo a mano con: git pull --rebase')
    }
    throw e
  }
}
