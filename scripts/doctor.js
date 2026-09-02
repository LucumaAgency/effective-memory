// Verifica que el entorno este listo. Uso:  npm run doctor
import { cfg, dirProyectos } from '../server/config.js'
import { correr } from '../server/util.js'
import fs from 'node:fs'

const linea = (ok, txt, extra = '') =>
  console.log(`${ok ? '  OK  ' : ' FALTA'} ${txt}${extra ? '  ->  ' + extra : ''}`)

console.log('\nvideo-review · diagnostico\n')

for (const [bin, args] of [[cfg.ffmpeg, ['-version']], [cfg.ffprobe, ['-version']], [cfg.python, ['--version']]]) {
  try {
    const { out, err } = await correr(bin, args)
    linea(true, bin, (out || err).split('\n')[0].slice(0, 60))
  } catch { linea(false, bin, 'no esta en el PATH') }
}

try {
  const { out } = await correr(cfg.python, ['-c', 'import faster_whisper,ctranslate2;print(ctranslate2.get_cuda_device_count())'])
  const gpus = Number(out.trim())
  linea(true, 'faster-whisper', gpus > 0 ? `${gpus} GPU CUDA detectada` : 'solo CPU (mas lento)')
} catch { linea(false, 'faster-whisper', 'pip install faster-whisper') }

const hayRepo = fs.existsSync(cfg.dataRepo)
linea(hayRepo, 'repo de datos', cfg.dataRepo)
if (hayRepo) {
  try { await correr('git', ['rev-parse', '--is-inside-work-tree'], { cwd: cfg.dataRepo }); linea(true, 'es repo git') }
  catch { linea(false, 'es repo git', 'clona video-review-proyectos ahi') }
  if (!fs.existsSync(dirProyectos())) fs.mkdirSync(dirProyectos(), { recursive: true })
}
console.log('')
