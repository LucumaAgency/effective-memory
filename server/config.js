import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// .env minimo, sin dependencias
function cargarEnv () {
  const f = path.join(RAIZ, '.env')
  if (!fs.existsSync(f)) return
  for (const linea of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    const valor = m[2].trim().replace(/^["']|["']$/g, '')
    if (!(m[1] in process.env)) process.env[m[1]] = valor
  }
}
cargarEnv()

const num = (k, def) => Number(process.env[k] ?? def)

export const cfg = {
  dataRepo: process.env.DATA_REPO || path.join(RAIZ, '..', 'video-review-proyectos'),
  puerto: num('PORT', 5180),
  ffmpeg: process.env.FFMPEG || 'ffmpeg',
  ffprobe: process.env.FFPROBE || 'ffprobe',
  python: process.env.PYTHON || 'python',
  whisperModelo: process.env.WHISPER_MODEL || 'medium',
  whisperDevice: process.env.WHISPER_DEVICE || 'auto',
  whisperLang: process.env.WHISPER_LANG || 'es',
  frameCada: num('FRAME_CADA', 10),
  frameAncho: num('FRAME_ANCHO', 640),
  silencioDb: num('SILENCIO_DB', -32),
  silencioMin: num('SILENCIO_MIN', 0.35),
  // Carpeta local donde estan los videos. Sirve para que un proyecto abierto en
  // dos maquinas distintas no necesite tocar meta.json, que va versionado.
  videosDir: process.env.VIDEOS_DIR || '',
  raizApp: RAIZ
}

/**
 * DATA_REPO no puede ser la carpeta de la app. Apuntarlo ahi hace que los
 * proyectos se escriban dentro del repo del codigo, que es publico, y que
 * "Pedir revision" publique transcripciones sin querer. Ya paso una vez.
 */
export function revisarDataRepo () {
  const mismo = path.resolve(cfg.dataRepo) === path.resolve(RAIZ)
  const pareceApp = fs.existsSync(path.join(cfg.dataRepo, 'server', 'index.js')) &&
    fs.existsSync(path.join(cfg.dataRepo, 'package.json'))
  if (mismo || pareceApp) {
    return `DATA_REPO apunta a la carpeta de la aplicación (${cfg.dataRepo}). ` +
      'Debe apuntar al clon de video-review-proyectos, que es privado. ' +
      'Corrige DATA_REPO en el .env antes de seguir.'
  }
  return null
}

export const dirProyectos = () => path.join(cfg.dataRepo, 'proyectos')
export const dirProyecto = (slug) => path.join(dirProyectos(), slug)
