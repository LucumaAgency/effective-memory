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
  } else if (D.estado.fase === 'sin-ingest') {
    $('#aviso').innerHTML = `<div class="aviso">Este proyecto no se ha procesado todavía.
      <div style="margin-top:9px"><button id="btnIngest">Procesar ahora</button></div></div>`
    $('#btnIngest').onclick = async () => {
      await api(`/api/proyectos/${slug}/ingest`, { method: 'POST' }); setTimeout(cargar, 500)
    }
  } else if (D.estado.fase !== 'listo') {
    $('#aviso').innerHTML = `<div class="aviso">Procesando: ${FASES[D.estado.fase] || D.estado.fase} ${Math.round(D.estado.progreso)}%. Puedes ver el video y comentar mientras tanto.</div>`
    // Solo se repite mientras haya algo en curso: antes un proyecto sin ingestar
    // recargaba la pagina cada 2s para siempre y borraba lo que tuvieras abierto.
    setTimeout(cargar, 2000)
  } else $('#aviso').innerHTML = ''

  pintarPista(); pintarComs(); pintarSilencios(); pintarTranscripcion(); pintarEntregas(); pintarClips(); pintarCortes()
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
  if (!$('#umbral').value) $('#umbral').value = D.silencios?.umbralDb ?? -32
  if (!$('#minSil').value) $('#minSil').value = D.silencios?.duracionMin ?? 0.35
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

async function recalcularSilencios () {
  const b = $('#btnSil'); b.disabled = true; b.textContent = 'Calculando…'
  try {
    const r = await api(`/api/proyectos/${slug}/silencios`, {
      method: 'POST',
      body: JSON.stringify({ umbralDb: Number($('#umbral').value), duracionMin: Number($('#minSil').value) })
    })
    alert(`${r.tramos} tramos · ${r.segundos}s en total con umbral ${r.umbralDb} dB y mínimo ${r.duracionMin}s`)
    cargar()
  } catch (e) { alert(e.message) } finally { b.disabled = false; b.textContent = 'Recalcular' }
}
$('#btnSil').onclick = recalcularSilencios

function pintarCortes () {
  const conCortes = (D.entregas || []).filter(e => e.cortes?.conservar?.length)
  const panel = $('#panelCortes')
  if (!conCortes.length) { panel.style.display = 'none'; return }
  panel.style.display = ''

  $('#cortes').innerHTML = conCortes.map(e => {
    const final = e.cortes.conservar.reduce((s, x) => s + (x.out - x.in), 0)
    const quita = (D.meta?.duracion || 0) - final
    return `<div style="margin-bottom:11px">
      <b style="color:var(--texto)">${escapar(e.version)}</b> · ${e.cortes.conservar.length} tramos
      <div>Quedaría en ${mmss(final)}, quita ${quita.toFixed(1)}s${
        e.cortes.subtitulos ? ' · con subtítulos quemados' : ''}</div>
      <div class="fila" style="margin-top:7px">
        <button data-cortes="${escapar(e.version)}">Aplicar cortes</button>
      </div>
    </div>`
  }).join('')

  $('#cortes').querySelectorAll('[data-cortes]').forEach(b => b.onclick = async () => {
    $('#cortesEstado').innerHTML = ''
    try {
      await api(`/api/proyectos/${slug}/cortes`, { method: 'POST', body: JSON.stringify({ entrega: b.dataset.cortes }) })
      seguirCortes()
    } catch (e) {
      $('#cortesEstado').innerHTML = `<div style="color:var(--corte)">${escapar(e.message)}</div>`
    }
  })
  seguirCortes().catch(() => {})
}

let temporizadorCortes = null
async function seguirCortes () {
  clearTimeout(temporizadorCortes)
  const r = await api(`/api/proyectos/${slug}/cortes/estado`)
  const caja = $('#cortesEstado')
  if (r.fase === 'aplicando') {
    caja.innerHTML = `<div>Aplicando cortes de ${escapar(r.entrega || '')}: ${r.tramos} tramos, ${mmss(r.duracionFinal || 0)} finales…</div>
      <div class="barra"><i style="width:${r.progreso || 0}%"></i></div>`
    temporizadorCortes = setTimeout(seguirCortes, 1200)
  } else if (r.fase === 'error') {
    caja.innerHTML = `<div style="color:var(--corte)">Falló: ${escapar(r.error || '')}</div>`
  } else caja.innerHTML = ''
  $('#cortes').querySelectorAll('[data-cortes]').forEach(b => { b.disabled = r.fase === 'aplicando' })
  cortesHechos = r.hechos || []
  pintarFuentes(ultimasPreviews, r.fase === 'listo' ? `cortes:${r.entrega}` : null)
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

let planClips = {}      // id -> clip de la entrega visible
let entregaVisible = null
let ultimoEstado = { fase: 'inactivo', hechos: [] }

function entregasConClips () {
  return (D.entregas || []).filter(e => e.plan?.clips?.length)
}

function pintarClips () {
  const conPlan = entregasConClips()
  const panel = $('#panelClips')
  if (!conPlan.length) { panel.style.display = 'none'; return }
  panel.style.display = ''

  // Una entrega a la vez: con varias versiones la lista se volvia interminable.
  if (!conPlan.some(e => e.version === entregaVisible)) {
    entregaVisible = conPlan[conPlan.length - 1].version
  }
  $('#entregaClips').innerHTML = conPlan.map(e =>
    `<option value="${escapar(e.version)}"${e.version === entregaVisible ? ' selected' : ''}>${escapar(e.version)} · ${e.plan.clips.length} clips</option>`).join('')

  const entrega = conPlan.find(e => e.version === entregaVisible)
  planClips = Object.fromEntries(entrega.plan.clips.map(c => [c.id, c]))

  const total = entrega.plan.clips.reduce((s, c) => s + (c.out - c.in), 0)
  $('#resumenClips').textContent =
    `${entrega.plan.clips.length} clips · ${mmss(total)} en total` +
    (entrega.nota?.resumen ? '' : '')

  $('#clips').innerHTML = entrega.plan.clips.map(c => `
    <div class="clip" id="clip_${escapar(entrega.version)}__${escapar(c.id)}" data-id="${escapar(c.id)}">
      <div style="display:flex;align-items:center;gap:8px">
        <b style="flex:1">${escapar(c.titulo || c.id)}</b>
        <span class="estadoClip" data-estado="${escapar(c.id)}">sin renderizar</span>
      </div>
      <div class="meta"><span class="t" data-t="${c.in}">${mmss(c.in)} → ${mmss(c.out)}</span> · ${Math.round(c.out - c.in)}s</div>
      ${c.gancho ? `<div class="gancho">“${escapar(c.gancho)}”</div>` : ''}
      ${c.razon ? `<button class="verMas">por qué este corte</button><div class="razon">${escapar(c.razon)}</div>` : ''}
      <div class="pie">
        <button data-clip="${escapar(c.id)}">Renderizar</button>
      </div>
      <div class="soporte"></div>
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
      <div class="graficos" data-grafs="${escapar(c.id)}"></div>
    </div>`).join('')

  $('#clips').querySelectorAll('.verMas').forEach(b =>
    b.onclick = () => b.closest('.clip').classList.toggle('abierto'))

  $('#clips').querySelectorAll('.t').forEach(el =>
    el.onclick = () => { $('#fuente').value = ''; cambiarFuente(); video.currentTime = Number(el.dataset.t); video.play() })

  $('#clips').querySelectorAll('[data-clip]').forEach(b =>
    b.onclick = () => lanzarClips([b.dataset.clip]))

  const comentarClip = async (id) => {
    const campo = document.querySelector(`#clips [data-textoclip="${id}"]`)
    const texto = campo.value.trim()
    if (!texto) return
    // Coordenadas del ORIGINAL: inicio del clip + posicion de su reproductor.
    const reproductor = document.querySelector(`[id$="__${id}"] video`)
    const dentro = reproductor ? reproductor.currentTime : 0
    await api(`/api/proyectos/${slug}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({
        t: +(planClips[id].in + dentro).toFixed(2),
        tipo: document.querySelector(`#clips [data-tipoclip="${id}"]`).value,
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
  pintarGraficos(entrega)
  aplicarEstadoClips(ultimoEstado)
  seguirClips().catch(() => {})
}

async function lanzarClips (ids) {
  $('#clipsEstado').innerHTML = ''
  try {
    await api(`/api/proyectos/${slug}/clips`, {
      method: 'POST', body: JSON.stringify({ entrega: entregaVisible, ids })
    })
    seguirClips()
  } catch (e) {
    // El error va al panel, no a un alert que se cierra y no deja rastro.
    $('#clipsEstado').innerHTML = `<div style="color:var(--corte)">No se pudo lanzar: ${escapar(e.message)}</div>`
  }
}

$('#entregaClips').onchange = (e) => { entregaVisible = e.target.value; pintarClips() }
$('#btnTodos').onclick = () => lanzarClips(null)

function pintarGraficos (entrega) {
  const todos = entrega.graficos?.graficos || []
  $('#clips').querySelectorAll('[data-grafs]').forEach(caja => {
    const suyos = todos.filter(g => g.clip === caja.dataset.grafs)
    if (!suyos.length) { caja.innerHTML = ''; caja.style.display = 'none'; return }
    caja.style.display = ''
    caja.innerHTML = suyos.map(g => `
      <div class="graf" data-graf="${escapar(g.id)}">
        <div class="cab">
          <b>gráfico</b>
          <span class="meta">${mmss(g.in)} → ${mmss(g.out)} · ${escapar(g.archivo)}</span>
          <button data-prev="${escapar(g.id)}">vista previa</button>
        </div>
        <div class="hueco"></div>
      </div>`).join('')

    caja.querySelectorAll('[data-prev]').forEach(b => b.onclick = () => {
      const g = suyos.find(x => x.id === b.dataset.prev)
      const hueco = b.closest('.graf').querySelector('.hueco')
      if (hueco.innerHTML) { hueco.innerHTML = ''; return }
      const dur = (g.out - g.in).toFixed(2)
      hueco.innerHTML = `<img alt="vista previa">
        <input type="range" min="0" max="${dur}" step="0.05" value="${Math.min(0.8, dur / 2).toFixed(2)}">
        <div class="meta" style="text-align:center">instante <span>0.80</span>s de ${dur}s</div>`
      const img = hueco.querySelector('img')
      const barra = hueco.querySelector('input')
      const etiqueta = hueco.querySelector('span')
      const refrescar = () => {
        etiqueta.textContent = Number(barra.value).toFixed(2)
        img.src = `/api/proyectos/${encodeURIComponent(slug)}/graficos/preview` +
          `?entrega=${encodeURIComponent(entrega.version)}&id=${encodeURIComponent(g.id)}&t=${barra.value}`
      }
      barra.oninput = refrescar
      refrescar()
    })
  })
}

function pintarComentariosDeClips () {
  const items = D.comentarios?.items || []
  $('#clips').querySelectorAll('[data-comsclip]').forEach(caja => {
    const id = caja.dataset.comsclip
    caja.innerHTML = items.filter(c => c.clip === id).map(c => {
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

/** Pinta el estado de la cola sobre las tarjetas ya dibujadas. */
function aplicarEstadoClips (r) {
  const caja = $('#clipsEstado')
  const enCurso = r.fase === 'renderizando'

  if (enCurso) {
    caja.innerHTML = `<div>Renderizando <b>${escapar(r.actual || '')}</b> de ${escapar(r.entrega || '')} (${r.i + 1} de ${r.total})…</div>
      <div class="barra"><i style="width:${(r.i / r.total) * 100}%"></i></div>`
  } else if (r.fase === 'error') {
    caja.innerHTML = `<div style="color:var(--corte)">Falló en ${escapar(r.actual || '')}: ${escapar(r.error || '')}</div>`
  } else caja.innerHTML = ''

  $('#clips').querySelectorAll('[data-clip]').forEach(b => { b.disabled = enCurso })
  $('#btnTodos').disabled = enCurso

  // Aceptamos tambien la forma antigua (sin "clave") por si el server no se
  // reinicio tras actualizar: sin esto el clip se renderiza y no aparece nunca.
  const hechos = new Map()
  for (const h of r.hechos || []) hechos.set(h.clave || h.id, h)
  $('#clips').querySelectorAll('.clip').forEach(tarjeta => {
    const id = tarjeta.dataset.id
    const etiqueta = tarjeta.querySelector('[data-estado]')
    const hecho = hechos.get(`${entregaVisible}__${id}`) || hechos.get(id)

    if (enCurso && r.actual === id && r.entrega === entregaVisible) {
      etiqueta.textContent = 'renderizando…'; etiqueta.className = 'estadoClip curso'
    } else if (r.fase === 'error' && r.actual === id) {
      etiqueta.textContent = 'falló'; etiqueta.className = 'estadoClip fallo'
    } else if (hecho) {
      etiqueta.textContent = `${(hecho.bytes / 1048576).toFixed(1)} MB`
      etiqueta.className = 'estadoClip listo'
    } else {
      etiqueta.textContent = 'sin renderizar'; etiqueta.className = 'estadoClip'
    }

    const soporte = tarjeta.querySelector('.soporte')
    const url = hecho
      ? `/api/proyectos/${encodeURIComponent(slug)}/clips/video?archivo=${encodeURIComponent(hecho.archivo)}&v=${hecho.bytes}`
      : null
    const actual = soporte.querySelector('video')
    if (!url) { soporte.innerHTML = ''; return }
    if (actual && actual.dataset.url === url) return
    soporte.innerHTML = ''
    const v = document.createElement('video')
    v.className = 'vertical'; v.controls = true; v.preload = 'none'
    v.src = url; v.dataset.url = url
    soporte.appendChild(v)
  })
}

let temporizadorClips = null
async function seguirClips () {
  clearTimeout(temporizadorClips)
  ultimoEstado = await api(`/api/proyectos/${slug}/clips/estado`)
  aplicarEstadoClips(ultimoEstado)
  if (ultimoEstado.fase === 'renderizando') temporizadorClips = setTimeout(seguirClips, 1200)
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

let cortesHechos = []
let ultimasPreviews = []

function pintarFuentes (renders, autoseleccionar) {
  ultimasPreviews = renders
  const sel = $('#fuente')
  const actual = sel.value
  sel.innerHTML = '<option value="">Video original</option>' +
    cortesHechos.map(c => `<option value="cortes:${escapar(c.entrega)}">cortado · ${escapar(c.entrega)} (${(c.bytes / 1048576).toFixed(1)} MB)</option>`).join('') +
    renders.map(r => `<option value="${escapar(r.archivo)}">preview · ${escapar(r.archivo)} (${(r.bytes / 1048576).toFixed(1)} MB)</option>`).join('')
  const elegido = autoseleccionar && autoseleccionar !== actual ? autoseleccionar : actual
  if ([...sel.options].some(o => o.value === elegido)) sel.value = elegido
  cambiarFuente()
}

function cambiarFuente () {
  const archivo = $('#fuente').value
  const nueva = !archivo
    ? `/api/proyectos/${encodeURIComponent(slug)}/video`
    : archivo.startsWith('cortes:')
      ? `/api/proyectos/${encodeURIComponent(slug)}/cortes/video?archivo=${encodeURIComponent(archivo.slice(7) + '.mp4')}`
      : `/api/proyectos/${encodeURIComponent(slug)}/render/video?archivo=${encodeURIComponent(archivo)}`
  if (video.dataset.fuente === nueva) return
  video.dataset.fuente = nueva
  video.src = nueva
  $('#notaFuente').textContent = !archivo ? ''
    : archivo.startsWith('cortes:')
      ? 'Versión cortada: la timeline de arriba sigue siendo la del original.'
      : 'La preview empieza en 0:00 aunque cubra otro tramo del original.'
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
