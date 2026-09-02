import { api, mmss, FASES, escapar } from './comun.js'

const $ = (s) => document.querySelector(s)
const slug = new URLSearchParams(location.search).get('p')
const video = $('#video')
let D = null
let duracion = 0

const pct = (t) => duracion ? (t / duracion) * 100 : 0

async function cargar () {
  D = await api(`/api/proyectos/${encodeURIComponent(slug)}`)
  duracion = D.meta?.duracion || video.duration || 0
  $('#titulo').textContent = D.meta?.titulo || slug
  $('#chipFase').textContent = FASES[D.estado.fase] || D.estado.fase
  if (!video.src) video.src = `/api/proyectos/${encodeURIComponent(slug)}/video`
  $('#rTotal').textContent = mmss(duracion)

  if (D.estado.fase === 'error') {
    $('#aviso').innerHTML = `<div class="aviso"><b>El ingest falló.</b><br>${escapar(D.estado.error || '')}</div>`
  } else if (!['listo'].includes(D.estado.fase)) {
    $('#aviso').innerHTML = `<div class="aviso">Procesando: ${FASES[D.estado.fase] || D.estado.fase} ${Math.round(D.estado.progreso)}%. Puedes ver el video y comentar mientras tanto.</div>`
    setTimeout(cargar, 2000)
  } else $('#aviso').innerHTML = ''

  pintarPista(); pintarComs(); pintarSilencios(); pintarTranscripcion(); pintarEntregas()
}

function pintarPista () {
  const p = $('#pista')
  const silencios = (D.silencios?.tramos || [])
    .map(s => `<div class="silencio" title="silencio ${s.dur}s en ${mmss(s.in)}"
      style="left:${pct(s.in)}%;width:${Math.max(pct(s.dur), 0.15)}%"></div>`).join('')
  const habla = (D.transcript?.segmentos || [])
    .map(s => `<div class="habla" style="left:${pct(s.in)}%;width:${Math.max(pct(s.out - s.in), 0.1)}%"></div>`).join('')
  const marcas = (D.comentarios?.items || [])
    .map(c => `<div class="marca tipo-${c.tipo}" data-t="${c.t}" data-id="${c.id}"
      title="${escapar(c.texto)}" style="left:${pct(c.t)}%;${c.estado === 'resuelto' ? 'opacity:.35' : ''}"></div>`).join('')
  p.innerHTML = silencios + habla + marcas + '<div class="cabeza" id="cabeza" style="left:0"></div>'

  p.onclick = (e) => {
    if (e.target.classList.contains('marca')) { video.currentTime = Number(e.target.dataset.t); return }
    const r = p.getBoundingClientRect()
    video.currentTime = ((e.clientX - r.left) / r.width) * duracion
  }
}

function pintarComs () {
  const items = D.comentarios?.items || []
  $('#coms').innerHTML = items.length ? items.map(c => `
    <div class="com ${c.tipo} ${c.estado === 'resuelto' ? 'resuelto' : ''}">
      <div class="cab">
        <span class="t" data-t="${c.t}">${mmss(c.t)}</span>
        <span class="meta">${c.tipo}</span>
        <span class="acc">
          <button data-accion="estado" data-id="${c.id}">${c.estado === 'resuelto' ? 'reabrir' : 'resolver'}</button>
          <button data-accion="borrar" data-id="${c.id}">✕</button>
        </span>
      </div>
      <div>${escapar(c.texto)}</div>
    </div>`).join('') : '<div class="vacio">Sin comentarios todavía.</div>'

  $('#coms').querySelectorAll('.t').forEach(el =>
    el.onclick = () => { video.currentTime = Number(el.dataset.t); video.play() })
  $('#coms').querySelectorAll('[data-accion]').forEach(b => b.onclick = async () => {
    const c = items.find(x => x.id === b.dataset.id)
    if (b.dataset.accion === 'borrar') {
      await api(`/api/proyectos/${slug}/comentarios/${c.id}`, { method: 'DELETE' })
    } else {
      await api(`/api/proyectos/${slug}/comentarios/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: c.estado === 'resuelto' ? 'abierto' : 'resuelto' })
      })
    }
    cargar()
  })
}

function pintarSilencios () {
  const t = D.silencios?.tramos || []
  const total = t.reduce((s, x) => s + x.dur, 0)
  $('#sil').innerHTML = t.length
    ? `<p>${t.length} tramos · ${total.toFixed(1)}s en total (${duracion ? Math.round(total / duracion * 100) : 0}% del video)</p>` +
      t.slice(0, 12).map(s => `<div><a href="#" data-t="${s.in}">${mmss(s.in)}</a> · ${s.dur.toFixed(2)}s</div>`).join('') +
      (t.length > 12 ? `<div style="margin-top:6px">…y ${t.length - 12} más</div>` : '')
    : 'Nada detectado todavía.'
  $('#sil').querySelectorAll('a').forEach(a => a.onclick = (e) => {
    e.preventDefault(); video.currentTime = Number(a.dataset.t)
  })
}

function pintarTranscripcion () {
  const segs = D.transcript?.segmentos || []
  $('#tr').innerHTML = segs.length
    ? segs.map(s => `<p data-in="${s.in}" data-out="${s.out}"><span>${mmss(s.in)}</span>${escapar(s.texto)}</p>`).join('')
    : '<div class="vacio">Sin transcripción todavía.</div>'
  $('#tr').querySelectorAll('p').forEach(p =>
    p.onclick = () => { video.currentTime = Number(p.dataset.in); video.play() })
}

function pintarEntregas () {
  $('#entregas').innerHTML = D.entregas?.length
    ? D.entregas.map(e => `<div style="margin-bottom:7px"><b style="color:var(--texto)">${escapar(e.version)}</b>
        <div>${e.archivos.map(escapar).join(' · ')}</div>
        ${e.nota?.resumen ? `<div style="margin-top:3px">${escapar(e.nota.resumen)}</div>` : ''}</div>`).join('')
    : 'Ninguna todavía. Pide una revisión y luego usa “Traer entrega” en la portada.'
}

// --- interaccion ---
video.addEventListener('timeupdate', () => {
  const c = document.getElementById('cabeza')
  if (c) c.style.left = pct(video.currentTime) + '%'
  $('#rActual').textContent = $('#tActual').textContent = mmss(video.currentTime)
  const t = video.currentTime
  $('#tr').querySelectorAll('p').forEach(p =>
    p.classList.toggle('activo', t >= Number(p.dataset.in) && t < Number(p.dataset.out)))
})
video.addEventListener('loadedmetadata', () => {
  if (!duracion) { duracion = video.duration; $('#rTotal').textContent = mmss(duracion); pintarPista() }
})

async function agregar () {
  const texto = $('#texto').value.trim()
  if (!texto) return
  await api(`/api/proyectos/${slug}/comentarios`, {
    method: 'POST',
    body: JSON.stringify({ t: +video.currentTime.toFixed(2), tipo: $('#tipo').value, texto })
  })
  $('#texto').value = ''
  cargar()
}
$('#btnCom').onclick = agregar
$('#texto').addEventListener('keydown', e => { if (e.key === 'Enter') agregar() })

$('#btnRevision').onclick = async () => {
  const b = $('#btnRevision'); b.disabled = true; b.textContent = 'Subiendo…'
  try {
    const r = await api(`/api/proyectos/${slug}/pedir-revision`, { method: 'POST' })
    alert(r.sinCambios ? 'No había cambios nuevos que subir.' : `Subido. Commit ${r.commit}`)
  } catch (e) { alert(e.message) } finally { b.disabled = false; b.textContent = 'Pedir revisión' }
}

document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
  if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause() }
  if (e.key === 'ArrowLeft') video.currentTime -= 2
  if (e.key === 'ArrowRight') video.currentTime += 2
  if (e.key.toLowerCase() === 'c') { e.preventDefault(); video.pause(); $('#texto').focus() }
})

cargar()
