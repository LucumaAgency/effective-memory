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
  if (!video.dataset.fuente) cambiarFuente()
  $('#rTotal').textContent = mmss(duracion)

  if (D.estado.fase === 'error') {
    $('#aviso').innerHTML = `<div class="aviso"><b>El ingest falló.</b><br>${escapar(D.estado.error || '')}
      <div style="margin-top:9px"><button id="btnReintentar">Reintentar ingest</button></div></div>`
    $('#btnReintentar').onclick = async () => {
      await api(`/api/proyectos/${slug}/ingest`, { method: 'POST' })
      setTimeout(cargar, 400)
    }
  } else if (!['listo'].includes(D.estado.fase)) {
    $('#aviso').innerHTML = `<div class="aviso">Procesando: ${FASES[D.estado.fase] || D.estado.fase} ${Math.round(D.estado.progreso)}%. Puedes ver el video y comentar mientras tanto.</div>`
    setTimeout(cargar, 2000)
  } else $('#aviso').innerHTML = ''

  pintarPista(); pintarComs(); pintarSilencios(); pintarTranscripcion(); pintarEntregas(); pintarClips()
  seguirRender().catch(() => {})
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
        ${c.clip ? `<span class="insignia">${escapar(c.clip)}</span>` : ''}
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
  if (!D.entregas?.length) {
    $('#entregas').innerHTML = 'Ninguna todavía. Pide una revisión y luego usa “Traer entrega” en la portada.'
    return
  }
  $('#entregas').innerHTML = D.entregas.map(e => {
    const tieneSubs = e.archivos.some(a => a.endsWith('.ass') || a.endsWith('.srt'))
    return `<div style="margin-bottom:13px;padding-bottom:11px;border-bottom:1px solid var(--linea)">
      <b style="color:var(--texto)">${escapar(e.version)}</b>
      <div>${e.archivos.map(escapar).join(' · ')}</div>
      ${e.nota?.resumen ? `<div style="margin-top:4px">${escapar(e.nota.resumen)}</div>` : ''}
      ${e.nota?.dudas?.length ? `<div style="margin-top:6px;color:var(--subtitulo)">Dudas:<ul style="margin:3px 0 0;padding-left:17px">${
        e.nota.dudas.map(d => `<li>${escapar(d)}</li>`).join('')}</ul></div>` : ''}
      ${tieneSubs ? `<div class="fila" style="margin-top:9px">
        <input type="number" id="d_${e.version}" value="0" min="0" style="max-width:72px" title="desde (s)">
        <input type="number" id="h_${e.version}" value="66" min="1" style="max-width:72px" title="hasta (s)">
        <button data-render="${e.version}" style="white-space:nowrap">Ver preview</button>
      </div>` : ''}
    </div>`
  }).join('')

  $('#entregas').querySelectorAll('[data-render]').forEach(b => b.onclick = async () => {
    const v = b.dataset.render
    b.disabled = true
    try {
      await api(`/api/proyectos/${slug}/render`, {
        method: 'POST',
        body: JSON.stringify({
          entrega: v,
          desde: Number($(`#d_${v}`).value) || 0,
          hasta: Number($(`#h_${v}`).value) || null
        })
      })
      seguirRender()
    } catch (e) { alert(e.message); b.disabled = false }
  })
}

let planClips = {}   // id -> {in, out, ...}

function pintarClips () {
  const conPlan = (D.entregas || []).filter(e => e.plan?.clips?.length)
  planClips = {}
  for (const e of conPlan) for (const c of e.plan.clips) planClips[c.id] = c
  const panel = $('#panelClips')
  if (!conPlan.length) { panel.style.display = 'none'; return }
  panel.style.display = ''

  $('#clips').innerHTML = conPlan.map(e => `
    <div class="meta" style="margin-bottom:8px">${escapar(e.version)} · ${e.plan.clips.length} clips
      <button data-todos="${escapar(e.version)}" style="padding:3px 9px;font-size:12px;margin-left:7px">Renderizar todos</button></div>
    ${e.plan.clips.map(c => `
      <div class="clip" id="clip_${escapar(e.version)}__${escapar(c.id)}">
        <b>${escapar(c.titulo || c.id)}</b>
        <div class="meta"><span class="t" data-t="${c.in}">${mmss(c.in)} → ${mmss(c.out)}</span> · ${Math.round(c.out - c.in)}s</div>
        ${c.gancho ? `<div class="gancho">“${escapar(c.gancho)}”</div>` : ''}
        ${c.razon ? `<div class="razon">${escapar(c.razon)}</div>` : ''}
        <div class="pie">
          <button data-clip="${escapar(c.id)}" data-entrega="${escapar(e.version)}">Renderizar</button>
          <span class="meta" data-listo="${escapar(c.id)}"></span>
        </div>
        <div class="comentar">
          <select data-tipoclip="${escapar(c.id)}">
            <option value="nota" selected>nota</option>
            <option value="corte">corte</option>
            <option value="subtitulo">subtítulo</option>
            <option value="grafico">gráfico</option>
          </select>
          <input data-textoclip="${escapar(c.id)}" placeholder="Comentar este clip…">
          <button data-comentarclip="${escapar(c.id)}">Añadir</button>
        </div>
        <div class="lista" data-comsclip="${escapar(c.id)}"></div>
      </div>`).join('')}`).join('')

  $('#clips').querySelectorAll('.t').forEach(el =>
    el.onclick = () => { $('#fuente').value = ''; cambiarFuente(); video.currentTime = Number(el.dataset.t); video.play() })

  const lanzar = (entrega, ids) => api(`/api/proyectos/${slug}/clips`, {
    method: 'POST', body: JSON.stringify({ entrega, ids })
  }).then(seguirClips).catch(e => alert(e.message))

  $('#clips').querySelectorAll('[data-clip]').forEach(b =>
    b.onclick = () => lanzar(b.dataset.entrega, [b.dataset.clip]))

  const comentarClip = async (id) => {
    const campo = $(`[data-textoclip="${id}"]`)
    const texto = campo.value.trim()
    if (!texto) return
    // El tiempo se guarda en coordenadas del ORIGINAL: inicio del clip + lo que
    // marque su reproductor. Asi el comentario tambien cae en la timeline grande.
    const reproductor = document.querySelector(`[id$="__${id}"] video`)
    const dentro = reproductor ? reproductor.currentTime : 0
    await api(`/api/proyectos/${slug}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({
        t: +(planClips[id].in + dentro).toFixed(2),
        tipo: $(`[data-tipoclip="${id}"]`).value,
        clip: id,
        texto
      })
    })
    campo.value = ''
    cargar()
  }
  $('#clips').querySelectorAll('[data-comentarclip]').forEach(b =>
    b.onclick = () => comentarClip(b.dataset.comentarclip))
  $('#clips').querySelectorAll('[data-textoclip]').forEach(i =>
    i.addEventListener('keydown', e => { if (e.key === 'Enter') comentarClip(i.dataset.textoclip) }))

  pintarComentariosDeClips()
  $('#clips').querySelectorAll('[data-todos]').forEach(b =>
    b.onclick = () => lanzar(b.dataset.todos, null))

  seguirClips().catch(() => {})
}

function pintarComentariosDeClips () {
  const items = D.comentarios?.items || []
  $('#clips').querySelectorAll('[data-comsclip]').forEach(caja => {
    const id = caja.dataset.comsclip
    const suyos = items.filter(c => c.clip === id)
    caja.innerHTML = suyos.map(c => {
      const dentro = Math.max(0, c.t - (planClips[id]?.in || 0))
      return `<div class="${c.tipo} ${c.estado === 'resuelto' ? 'resuelto' : ''}">
        <span class="quitar" data-borrarcom="${c.id}" title="Borrar">✕</span>
        <b style="color:var(--acento)">${mmss(dentro)}</b> · ${escapar(c.tipo)} — ${escapar(c.texto)}</div>`
    }).join('')
  })
  $('#clips').querySelectorAll('[data-borrarcom]').forEach(x => x.onclick = async () => {
    await api(`/api/proyectos/${slug}/comentarios/${x.dataset.borrarcom}`, { method: 'DELETE' })
    cargar()
  })
}

let temporizadorClips = null
async function seguirClips () {
  clearTimeout(temporizadorClips)
  const r = await api(`/api/proyectos/${slug}/clips/estado`)
  const caja = $('#clipsEstado')

  if (r.fase === 'renderizando') {
    caja.innerHTML = `<div>Renderizando ${escapar(r.actual || '')} (${r.i + 1} de ${r.total})…</div>
      <div class="barra"><i style="width:${((r.i) / r.total) * 100}%"></i></div>`
    temporizadorClips = setTimeout(seguirClips, 1200)
  } else if (r.fase === 'error') {
    caja.innerHTML = `<div style="color:var(--corte)">Falló en ${escapar(r.actual || '')}: ${escapar(r.error || '')}</div>`
  } else caja.innerHTML = ''

  $('#clips').querySelectorAll('[data-clip],[data-todos]').forEach(b => { b.disabled = r.fase === 'renderizando' })

  for (const hecho of r.hechos || []) {
    const caja = document.getElementById(`clip_${hecho.clave}`)
    if (!caja || caja.querySelector('video')) continue
    const etiqueta = caja.querySelector('[data-listo]')
    if (etiqueta) etiqueta.textContent = `${(hecho.bytes / 1048576).toFixed(1)} MB`
    const v = document.createElement('video')
    v.className = 'vertical'; v.controls = true; v.preload = 'none'
    v.src = `/api/proyectos/${encodeURIComponent(slug)}/clips/video?archivo=${encodeURIComponent(hecho.archivo)}`
    caja.appendChild(v)
  }
}

let temporizadorRender = null
async function seguirRender () {
  clearTimeout(temporizadorRender)
  const r = await api(`/api/proyectos/${slug}/render/estado`)
  const caja = $('#renderEstado')

  if (r.fase === 'renderizando') {
    caja.innerHTML = `<div>Renderizando ${escapar(r.archivo || '')}…</div>
      <div class="barra"><i style="width:${r.progreso || 0}%"></i></div>`
    temporizadorRender = setTimeout(seguirRender, 900)
  } else if (r.fase === 'error') {
    caja.innerHTML = `<div style="color:var(--corte)">Falló el render: ${escapar(r.error || '')}</div>`
  } else if (r.fase === 'listo') {
    caja.innerHTML = `<div style="color:var(--ok)">Listo: ${escapar(r.archivo)}</div>`
  } else caja.innerHTML = ''

  pintarFuentes(r.renders || [], r.fase === 'listo' ? r.archivo : null)
  $('#entregas').querySelectorAll('[data-render]').forEach(b => { b.disabled = r.fase === 'renderizando' })
}

function pintarFuentes (renders, autoseleccionar) {
  const sel = $('#fuente')
  const actual = sel.value
  sel.innerHTML = '<option value="">Video original</option>' +
    renders.map(r => `<option value="${escapar(r.archivo)}">preview · ${escapar(r.archivo)} (${(r.bytes / 1048576).toFixed(1)} MB)</option>`).join('')
  const elegido = autoseleccionar && autoseleccionar !== actual ? autoseleccionar : actual
  if ([...sel.options].some(o => o.value === elegido)) sel.value = elegido
  cambiarFuente()
}

function cambiarFuente () {
  const archivo = $('#fuente').value
  const nueva = archivo
    ? `/api/proyectos/${encodeURIComponent(slug)}/render/video?archivo=${encodeURIComponent(archivo)}`
    : `/api/proyectos/${encodeURIComponent(slug)}/video`
  if (video.dataset.fuente === nueva) return
  video.dataset.fuente = nueva
  video.src = nueva
  $('#notaFuente').textContent = archivo
    ? 'La preview empieza en 0:00 aunque cubra otro tramo del original.'
    : ''
}
$('#fuente').onchange = cambiarFuente

// --- interaccion ---
video.addEventListener('timeupdate', () => {
  if ($('#fuente').value) { $('#rActual').textContent = $('#tActual').textContent = mmss(video.currentTime); return }
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
