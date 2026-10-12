#!/usr/bin/env node
// Exporta una entrega (clips.json) a un proyecto de FilmCraft para ajustarla a mano.
//
//   node scripts/exportar_filmcraft.js <carpeta-proyecto> <entrega> [--cli ruta] [--pc-base G:\...]
//
// Genera entregas/<entrega>/filmcraft/ con:
//   <slug>-<entrega>.fcproj   una secuencia 1080x1920 por clip (video, audio, subtitulos, b-roll)
//   <clip>.otio / .fcpxml     intercambio por clip (Resolve, Premiere, etc.)
//   <clip>.srt                subtitulos del clip, en tiempos del clip
//
// El video NO viaja: el proyecto apunta a la ruta del original en la PC (meta.videoPath) y los
// b-roll a la copia del repo de datos en la PC (--pc-base). FilmCraft los enlaza al abrir.
// Todo se calcula en coordenadas del original y se rebasa al clip, como el resto del pipeline.
//
// Requiere filmcraft-cli (storytold/filmcraft) en el PATH o via --cli. Corre sin pantalla.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { armarCues } from '../server/subtitulos.js'

const TICK = 254016000000           // ticks por segundo (misma base que Premiere)
const t = (s) => Math.round(s * TICK)

const args = process.argv.slice(2)
const pos = args.filter(a => !a.startsWith('--'))
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
if (pos.length < 2) {
  console.error('uso: exportar_filmcraft.js <carpeta-proyecto> <entrega> [--cli filmcraft-cli] [--pc-base G:\\...]')
  process.exit(2)
}
const [dir, entrega] = pos
const cli = opt('--cli', 'filmcraft-cli')
const pcBase = opt('--pc-base', 'G:\\innovations\\lucuma-editor\\video-review-proyectos\\proyectos')

const leer = (f, d) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d
const meta = leer(path.join(dir, 'meta.json'))
const transcript = leer(path.join(dir, 'transcript.json'), { segmentos: [] })
const correcciones = leer(path.join(dir, 'correcciones.json'), { reemplazos: [] }).reemplazos || []
const plan = leer(path.join(dir, 'entregas', entrega, 'clips.json'))
const graficos = leer(path.join(dir, 'entregas', entrega, 'graficos.json'), { graficos: [] }).graficos || []
if (!meta || !plan) { console.error('faltan meta.json o clips.json'); process.exit(1) }

const slug = meta.slug || path.basename(dir)
const salida = path.join(dir, 'entregas', entrega, 'filmcraft')
fs.mkdirSync(salida, { recursive: true })
const W = plan.formato?.ancho || 1080, H = plan.formato?.alto || 1920
const fps = meta.fps || 23.976
const srcW = meta.ancho, srcH = meta.alto

// ---------- subtitulos ----------
const corregir = (s) => correcciones.reduce((acc, [p, r]) => acc.replace(new RegExp(p, 'g'), r), s)
function dosLineas (texto, max) {
  if (texto.length <= max) return texto
  const pal = texto.split(' ')
  let mejor = null, coste = Infinity
  for (let i = 1; i < pal.length; i++) {
    const a = pal.slice(0, i).join(' '), b = pal.slice(i).join(' ')
    if (a.length > max || b.length > max) continue
    if (Math.abs(a.length - b.length) < coste) { mejor = [a, b]; coste = Math.abs(a.length - b.length) }
  }
  if (!mejor) { const i = Math.ceil(pal.length / 2); mejor = [pal.slice(0, i).join(' '), pal.slice(i).join(' ')] }
  return mejor.join('\n')
}
const srtT = (s) => {
  const ms = Math.round(Math.max(0, s) * 1000)
  const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), sec = Math.floor(ms % 60000 / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}
function srtDeClip (clip) {
  const maxLinea = plan.estilo?.maxLinea || 30
  const cues = armarCues(transcript, clip.in, clip.out, { maxLinea })
  return cues.map((c, i) =>
    `${i + 1}\n${srtT(c.in - clip.in)} --> ${srtT(Math.min(c.out, clip.out) - clip.in)}\n${dosLineas(corregir(c.texto), maxLinea)}\n`
  ).join('\n')
}

// ---------- encuadre -> motion de FilmCraft ----------
// La ventana 9:16 dentro del original mide w9 x srcH y su x sigue al sujeto (centros);
// el zoom Z recorta dentro de esa ventana anclado en anclaY. Equivale, en FilmCraft, a
// escalar el clip S = (W / w9) * Z y mover su centro (anchor) a la posicion que deje la
// ventana visible justo en el fotograma.
function motionDe (enc, clip) {
  const w9 = srcH * W / H
  const base = Number(enc?.zoom) || 1
  const anclaY = Math.min(1, Math.max(0, Number(enc?.anclaY ?? 0.5)))
  const centros = [...(enc?.centros || [])].sort((a, b) => a.t - b.t)
  const enfasis = enc?.enfasis || []
  const rampa = (e) => Math.max(0.05, Number(e.rampa ?? enc?.rampa ?? 0.5))

  const cxEn = (tt) => {
    if (!centros.length) return srcW / 2
    if (tt <= centros[0].t) return centros[0].x
    for (let i = 0; i < centros.length - 1; i++) {
      const a = centros[i], b = centros[i + 1]
      if (tt >= a.t && tt <= b.t) {
        if (b.t - a.t < 0.2) return tt < b.t ? a.x : b.x
        return a.x + (b.x - a.x) * (tt - a.t) / (b.t - a.t)
      }
    }
    return centros[centros.length - 1].x
  }
  const zEn = (tt) => {
    let extra = 0
    for (const e of enfasis) {
      const k = (Number(e.zoom) || 1.08) - 1, r = rampa(e)
      if (tt < e.in || tt > e.out) continue
      const sube = Math.min(1, (tt - e.in) / r), baja = Math.min(1, (e.out - tt) / r)
      extra += k * Math.min(sube, baja)
    }
    return base * (1 + extra)
  }
  const estado = (tt) => {
    const Z = zEn(tt), S = (W / w9) * Z
    const cx = Math.min(Math.max(cxEn(tt), w9 / 2), srcW - w9 / 2)
    const x0 = cx - w9 / (2 * Z)
    const y0 = (srcH - srcH / Z) * anclaY
    return { scale: +(S * 100).toFixed(3), pos: [+((srcW / 2 - x0) * S).toFixed(2), +((srcH / 2 - y0) * S).toFixed(2)] }
  }

  // instantes con keyframe: inicio, centros, bordes y rampas de cada enfasis
  const ts = new Set([clip.in])
  centros.forEach(c => { if (c.t >= clip.in && c.t <= clip.out) ts.add(c.t) })
  enfasis.forEach(e => [e.in, e.in + rampa(e), e.out - rampa(e), e.out]
    .forEach(x => { if (x >= clip.in && x <= clip.out) ts.add(x) }))
  const lista = [...ts].sort((a, b) => a - b)
  const animado = lista.length > 1
  return { animado, frames: lista.map(tt => ({ t: tt - clip.in, ...estado(tt) })) }
}


// Tamaño de una imagen (JPEG/PNG) leyendo la cabecera, sin dependencias.
function tamanoImagen (f) {
  const b = fs.readFileSync(f)
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  if (b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2
    while (i < b.length) {
      if (b[i] !== 0xFF) { i++; continue }
      const m = b[i + 1]
      if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return null
}

// B-roll con la semantica de plantillas/pan.html: la foto cubre el cuadro (cover) recortando
// alrededor de `foco`, con un zoom extra de `recorrido` % que se desplaza de un lado al otro
// durante el clip, y un fundido de `entrada` segundos al entrar y salir.
function motionBroll (dat, w, h, dur) {
  const rec = Number(dat.recorrido ?? 8)
  const foco = Math.min(100, Math.max(0, Number(dat.foco ?? 50)))
  const z = (Number(dat.zoom) || 1) * (1 + rec / 100)
  const haciaDer = (dat.direccion || 'izquierda-derecha') === 'izquierda-derecha'
  const Sc = Math.max(W / w, H / h)
  const sw = w * Sc, sh = h * Sc
  const cx = -(sw - W) * foco / 100 + sw / 2
  const cy = -(sh - H) / 2 + sh / 2
  const cxz = W / 2 + (cx - W / 2) * z, cyz = H / 2 + (cy - H / 2) * z
  const desde = (haciaDer ? rec / 2 : -rec / 2) * W / 100
  return {
    scale: +(Sc * z * 100).toFixed(3),
    ini: [+(cxz + desde).toFixed(2), +cyz.toFixed(2)],
    fin: [+(cxz - desde).toFixed(2), +cyz.toFixed(2)],
    fundido: Math.min(Number(dat.entrada ?? 0.35), dur / 2)
  }
}

// ---------- comandos ----------
const cmds = []
const c = (id, params) => cmds.push({ id, params })
const estilo = plan.estilo || {}
const colorAss = (v, d) => (typeof v === 'string' && /^&H/.test(v)) ? '#' + v.slice(-2) + v.slice(-4, -2) + v.slice(-6, -4) : d

c('file.newOfflineFile', {
  name: path.basename(meta.videoPath), fileName: meta.videoPath,
  width: srcW, height: srcH, fps, seconds: meta.duracion
})
const ITEM_VIDEO = '$video'
const indice = []
for (const clip of plan.clips || []) {
  const dur = clip.out - clip.in
  const enc = clip.encuadre || plan.encuadre
  const srt = path.join(salida, `${clip.id}.srt`)
  fs.writeFileSync(srt, srtDeClip(clip))
  const gs = graficos.filter(g => g.clip === clip.id)

  c('file.newSequence', { name: `${clip.id} ${clip.titulo || ''}`.trim(), width: W, height: H, fps, video: 2, audio: 1 })
  c('timeline.place', { item: ITEM_VIDEO, track: 'V1', audioTrack: 'A1', seconds: 0, insert: false, sourceIn: t(clip.in), duration: t(dur) })
  const m = motionDe(enc, clip)
  const primero = m.frames[0]
  c('effects.setParam', { clip: '$ultimo', effect: 'motion', param: 'scale', value: primero.scale })
  c('effects.setParam', { clip: '$ultimo', effect: 'motion', param: 'position', value: primero.pos })
  if (m.animado) {
    for (const f of m.frames) {
      c('effects.setParam', { clip: '$ultimo', effect: 'motion', param: 'scale', value: f.scale, time: t(f.t), keyframe: true })
      c('effects.setParam', { clip: '$ultimo', effect: 'motion', param: 'position', value: f.pos, time: t(f.t), keyframe: true })
    }
  }
  if (clip.subtitulos !== false && plan.subtitulos !== false) {
    c('captions.import', { path: srt, name: 'Subtítulos' })
    c('captions.setStyle', {
      track: 'C1', font: estilo.fuente || 'Montserrat SemiBold', size: estilo.tamano || 56,
      color: colorAss(estilo.texto, '#FFFFFF'), outline: estilo.borde === 'contorno' ? (estilo.relleno || 4) : 0,
      outlineColor: colorAss(estilo.contorno, '#000000'), background: estilo.borde !== 'contorno',
      backgroundColor: colorAss(estilo.caja, '#FFFFFF') + 'FF', align: 'center', anchor: 'bottom',
      margin: Math.min(0.45, (estilo.margenV || 260) / H)
    })
  }
  for (const g of gs) {
    const archivo = g.datos?.archivo
    const gdur = g.out - g.in
    if (archivo) {
      const ruta = `${pcBase}\\${slug}\\entregas\\${entrega}\\graficos\\${archivo}`
      const local = path.join(dir, 'entregas', entrega, 'graficos', archivo)
      const tam = (fs.existsSync(local) && tamanoImagen(local)) || { w: g.ancho || W, h: g.alto || H }
      c('file.newOfflineFile', { name: `${g.id} ${archivo}`, fileName: ruta, audio: false, width: tam.w, height: tam.h, fps, seconds: gdur })
      c('timeline.place', { item: '$ultimoItem', track: 'V2', seconds: g.in - clip.in, insert: false, duration: t(gdur), audio: false })
      if (g.archivo === 'pan.html' || !g.archivo) {
        const mb = motionBroll(g.datos || {}, tam.w, tam.h, gdur)
        c('effects.setParam', { clip: '$ultimoV2', effect: 'motion', param: 'scale', value: mb.scale })
        c('effects.setParam', { clip: '$ultimoV2', effect: 'motion', param: 'position', value: mb.ini, time: 0, keyframe: true })
        c('effects.setParam', { clip: '$ultimoV2', effect: 'motion', param: 'position', value: mb.fin, time: t(gdur), keyframe: true })
        if (mb.fundido > 0) {
          c('effects.setParam', { clip: '$ultimoV2', effect: 'opacity', param: 'opacity', value: 0, time: 0, keyframe: true })
          c('effects.setParam', { clip: '$ultimoV2', effect: 'opacity', param: 'opacity', value: 100, time: t(mb.fundido), keyframe: true })
          c('effects.setParam', { clip: '$ultimoV2', effect: 'opacity', param: 'opacity', value: 100, time: t(gdur - mb.fundido), keyframe: true })
          c('effects.setParam', { clip: '$ultimoV2', effect: 'opacity', param: 'opacity', value: 0, time: t(gdur), keyframe: true })
        }
      }
    }
    c('markers.add', { seconds: g.in - clip.in, durationSeconds: gdur, name: `${g.id} ${g.archivo || ''} ${archivo || ''}: ${g.describe || ''}`.trim() })
  }
  if (clip.congelar) c('markers.add', { seconds: clip.congelar - clip.in, name: `congelar fotograma (${clip.congelar}s del original)` })
  c('markers.add', { seconds: 0, name: `gancho: ${clip.gancho || ''}` })
  c('file.exportOtio', { path: path.join(salida, `${clip.id}.otio`) })
  c('file.exportFcpxml', { path: path.join(salida, `${clip.id}.fcpxml`) })
  indice.push({ id: clip.id, titulo: clip.titulo, in: clip.in, out: clip.out, dur: +dur.toFixed(2), graficos: gs.length })
}

// Resolver ids ($video, $ultimo, $ultimoItem) ejecutando de a uno: el resultado de cada
// comando alimenta los siguientes.
const proyecto = path.join(salida, `${slug}-${entrega}.fcproj`)
if (fs.existsSync(proyecto)) fs.unlinkSync(proyecto)
const ctx = {}
const resolver = (v) => {
  if (v === '$video') return ctx.video
  if (v === '$ultimo') return ctx.ultimoClip
  if (v === '$ultimoItem') return ctx.ultimoItem
  if (v === '$ultimoV2') return ctx.ultimoV2
  return v
}
const lineas = []
const medios = []
let fallos = 0
// Primera pasada: creamos el proyecto con el primer comando y guardamos; luego acumulamos.
for (let i = 0; i < cmds.length; i++) {
  const { id, params } = cmds[i]
  const p = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, resolver(v)]))
  const argv = [...(i === 0 ? ['--save-as', proyecto] : ['--project', proyecto, '--save']), 'exec', id, JSON.stringify(p)]
  const r = spawnSync(cli, argv, { encoding: 'utf8' })
  const out = (r.stdout || '').trim()
  let res = null
  try { res = JSON.parse(out) } catch { /* texto plano */ }
  const ok = r.status === 0 && !(res && res.ok === false) && !/error/i.test(r.stderr || '')
  lineas.push(`${ok ? 'ok ' : 'ERR'} ${id} ${JSON.stringify(p).slice(0, 140)} -> ${out.slice(0, 160)}${r.stderr ? ' | ' + r.stderr.trim().slice(0, 200) : ''}`)
  if (!ok) { fallos++; continue }
  const d = (res && res.result) || res || {}
  if (id === 'file.newOfflineFile') { ctx.ultimoItem = d.item; if (!ctx.video) ctx.video = d.item; medios.push({ item: d.item, ruta: p.fileName }) }
  if (id === 'timeline.place' && p.track === 'V1') ctx.ultimoClip = d.clips?.[0]
  if (id === 'timeline.place' && p.track === 'V2') ctx.ultimoV2 = d.clips?.[0]
}
// Script de enlace para la PC: FilmCraft rechaza en el dialogo un archivo cuya duracion no
// coincide con la del offline (ffmpeg y FilmCraft miden distinto); media.relink con force si lo acepta.
// PowerShell 5 rompe el JSON en linea al llamar a un .exe: los comandos van en un .jsonl.
fs.writeFileSync(path.join(salida, 'enlazar.jsonl'), medios.map(m =>
  JSON.stringify({ id: 'media.relink', params: { item: m.item, path: m.ruta, force: true, relinkOthers: false } })).join('\n') + '\n')
const ps1 = [
  '# Enlaza los medios del proyecto FilmCraft forzando la coincidencia. Ejecutar en PowerShell',
  '# con FilmCraft CERRADO (la CLI escribe el .fcproj).',
  '$cli = "C:\\Program Files\\FilmCraft\\filmcraft-cli.exe"',
  '$proy = Join-Path $PSScriptRoot "' + path.basename(proyecto) + '"',
  '$cmds = Join-Path $PSScriptRoot "enlazar.jsonl"',
  '& $cli --project $proy --save run $cmds',
  'Write-Host "Listo: abre $proy en FilmCraft"'
].join('\r\n') + '\r\n'
fs.writeFileSync(path.join(salida, 'enlazar.ps1'), ps1)
fs.writeFileSync(path.join(salida, 'registro.txt'), lineas.join('\n') + '\n')
fs.writeFileSync(path.join(salida, 'README.md'), `# FilmCraft: ${slug} ${entrega}

Generado por \`scripts/exportar_filmcraft.js\` el ${new Date().toISOString().slice(0, 10)}.

- **${path.basename(proyecto)}**: abrir en FilmCraft. Una secuencia por clip (${W}x${H}, ${fps} fps).
  El video apunta a \`${meta.videoPath}\`; los b-roll a \`${pcBase}\\${slug}\\...\`.
  Si FilmCraft los marca offline, cerrar FilmCraft y ejecutar enlazar.ps1 (clic derecho > Ejecutar con PowerShell); fuerza el enlace aunque la duración difiera.
- **cNN.otio / cNN.fcpxml**: el mismo timeline para Resolve, Premiere o cualquier NLE.
- **cNN.srt**: subtítulos del clip (tiempos desde 0 = inicio del clip).
- Pista V1: el original recortado a 9:16 con el encuadre dinámico traducido a Motion (escala + posición con keyframes).
  Pista V2: los b-roll como imágenes. Marcadores: gancho, b-roll y congelado.
- Los tiempos del original se recuperan con \`in\` de cada clip en clips.json (clip = original − in).

| clip | título | in | out | dur | b-roll |
|---|---|---|---|---|---|
${indice.map(i => `| ${i.id} | ${i.titulo || ''} | ${i.in} | ${i.out} | ${i.dur}s | ${i.graficos} |`).join('\n')}

Comandos: ${cmds.length}, fallos: ${fallos} (ver registro.txt).
`)
console.log(`${proyecto}\ncomandos ${cmds.length}, fallos ${fallos}`)
process.exit(fallos ? 1 : 0)
