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
  raizApp: RAIZ
}

export const dirProyectos = () => path.join(cfg.dataRepo, 'proyectos')
export const dirProyecto = (slug) => path.join(dirProyectos(), slug)
