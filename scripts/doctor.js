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
  } catch {
    const esRuta = /[\\/]/.test(bin)
    linea(false, bin, esRuta
      ? (fs.existsSync(bin) ? 'el archivo existe pero no se pudo ejecutar' : 'esa ruta no existe, corrige el .env')
      : 'no esta en el PATH, o pon la ruta completa en el .env')
  }
}

let gpus = 0
try {
  const { out } = await correr(cfg.python, ['-c', 'import faster_whisper,ctranslate2;print(ctranslate2.get_cuda_device_count())'])
  gpus = Number(out.trim()) || 0
  linea(true, 'faster-whisper', gpus > 0 ? `${gpus} GPU CUDA detectada` : 'solo CPU (mas lento)')
} catch { linea(false, 'faster-whisper', 'pip install faster-whisper') }

// Sin GPU CUDA no hay nada que instalar: marcarlo como FALTA seria mentir.
if (gpus === 0) {
  console.log('  --   librerias CUDA  ->  no aplica: esta maquina no tiene GPU NVIDIA')
} else {
  // Las DLL que pip instala no quedan en el PATH; el script las registra solo,
  // pero aqui avisamos si ni siquiera estan instaladas.
  try {
    const { out } = await correr(cfg.python, ['-c',
      'import nvidia,os;print(",".join(sorted(p for r in nvidia.__path__ for p in os.listdir(r) if os.path.isdir(os.path.join(r,p,"bin")))))'])
    const paquetes = out.trim()
    const faltan = ['cublas', 'cudnn'].filter(k => !paquetes.includes(k))
    linea(faltan.length === 0, 'librerias CUDA', faltan.length
      ? `falta ${faltan.join(' y ')}  ->  pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"`
      : paquetes)
  } catch {
    linea(false, 'librerias CUDA', 'pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"')
  }
}

// Con el modelo grande y sin GPU la espera se dispara; mejor decirlo antes.
if (gpus === 0 && ['medium', 'large', 'large-v2', 'large-v3'].includes(cfg.whisperModelo)) {
  console.log(`  --   aviso  ->  WHISPER_MODEL=${cfg.whisperModelo} sin GPU es muy lento; prueba small o base`)
}

const { buscarNavegador } = await import('../server/navegador.js')
const nav = buscarNavegador()
linea(!!nav, 'navegador (motion graphics)', nav || 'no encuentro Chrome ni Edge; pon la ruta en NAVEGADOR= del .env')

const hayRepo = fs.existsSync(cfg.dataRepo)
linea(hayRepo, 'repo de datos', cfg.dataRepo)
if (hayRepo) {
  try { await correr('git', ['rev-parse', '--is-inside-work-tree'], { cwd: cfg.dataRepo }); linea(true, 'es repo git') }
  catch { linea(false, 'es repo git', 'clona video-review-proyectos ahi') }
  if (!fs.existsSync(dirProyectos())) fs.mkdirSync(dirProyectos(), { recursive: true })
}
console.log('')
