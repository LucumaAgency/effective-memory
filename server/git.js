import { cfg } from './config.js'
import { correr } from './util.js'

const git = (args) => correr('git', args, { cwd: cfg.dataRepo })

export async function estadoRepo () {
  try {
    const { out: rama } = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const { out: sucio } = await git(['status', '--porcelain'])
    let atras = 0
    try {
      await git(['fetch', '--quiet'])
      const { out } = await git(['rev-list', '--count', 'HEAD..@{u}'])
      atras = Number(out.trim()) || 0
    } catch { /* sin upstream o sin red */ }
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
  await git(['add', '--all', '.'])
  const { out } = await git(['status', '--porcelain'])
  if (out.trim()) {
    await git(['commit', '-m', mensaje || `revision: ${slug}`])
  }
  await git(['push'])
  const { out: sha } = await git(['rev-parse', '--short', 'HEAD'])
  return { commit: sha.trim(), sinCambios: !out.trim() }
}

// Boton "Traer entrega".
export async function traer () {
  const { out } = await git(['pull', '--ff-only'])
  return { salida: out.trim() }
}
