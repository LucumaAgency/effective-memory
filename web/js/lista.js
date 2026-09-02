import { api, mmss, FASES, escapar } from './comun.js'

const $ = (s) => document.querySelector(s)
let temporizador = null

async function salud () {
  try {
    const s = await api('/api/salud')
    $('#chipRepo').textContent = s.git.ok
      ? `${s.git.rama} · ${s.git.pendientes} sin subir${s.git.entregasNuevas ? ` · ${s.git.entregasNuevas} entregas nuevas` : ''}`
      : 'repo de datos no configurado'
    if (!s.git.ok) {
      $('#aviso').innerHTML = `<div class="aviso"><b>El repo de datos no está listo.</b><br>
        Esperaba encontrarlo en <code>${escapar(s.dataRepo)}</code>. Clónalo ahí y ajusta <code>DATA_REPO</code> en el archivo <code>.env</code>.
        <br><small>${escapar(s.git.error || '')}</small></div>`
    } else $('#aviso').innerHTML = ''
  } catch (e) { $('#chipRepo').textContent = 'sin conexión' }
}

function tarjeta (p) {
  const procesando = !['listo', 'error', 'sin-ingest'].includes(p.fase)
  return `<div class="tarjeta">
    <div style="flex:1;min-width:0">
      <h3><a href="/proyecto.html?p=${encodeURIComponent(p.slug)}">${escapar(p.titulo)}</a></h3>
      <div class="meta">${mmss(p.duracion)} · ${p.abiertos} comentarios abiertos de ${p.comentarios}${
        p.entregas.length ? ` · entregas: ${p.entregas.map(e => escapar(e.version)).join(', ')}` : ''}</div>
      ${procesando ? `<div class="barra"><i style="width:${p.progreso}%"></i></div>
        <div class="meta" style="margin-top:4px">${FASES[p.fase] || p.fase} ${Math.round(p.progreso)}%</div>` : ''}
      ${p.error ? `<div class="meta" style="color:var(--corte);margin-top:5px;word-break:break-word">${escapar(p.error)}</div>` : ''}
    </div>
    <span class="chip" style="${p.fase === 'error' ? 'color:var(--corte)' : p.fase === 'listo' ? 'color:var(--ok)' : ''}">${FASES[p.fase] || p.fase}</span>
  </div>`
}

async function pintar () {
  const ps = await api('/api/proyectos')
  $('#lista').innerHTML = ps.length
    ? ps.map(tarjeta).join('')
    : '<div class="vacio">Todavía no hay proyectos. Pega la ruta de un video arriba.</div>'
  const activos = ps.some(p => !['listo', 'error', 'sin-ingest'].includes(p.fase))
  clearTimeout(temporizador)
  if (activos) temporizador = setTimeout(pintar, 1500)
}

$('#btnCrear').onclick = async () => {
  const ruta = $('#ruta').value.trim()
  if (!ruta) return
  $('#btnCrear').disabled = true
  try {
    await api('/api/proyectos', { method: 'POST', body: JSON.stringify({ titulo: $('#titulo').value, videoPath: ruta }) })
    $('#ruta').value = ''; $('#titulo').value = ''
    pintar()
  } catch (e) { alert(e.message) } finally { $('#btnCrear').disabled = false }
}

$('#btnTraer').onclick = async () => {
  $('#btnTraer').disabled = true
  try { const r = await api('/api/traer', { method: 'POST' }); alert(r.salida || 'Ya estabas al día.'); pintar(); salud() }
  catch (e) { alert(e.message) } finally { $('#btnTraer').disabled = false }
}

salud(); pintar()
