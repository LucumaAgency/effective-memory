import { api, mmss, FASES, escapar } from './comun.js'

const $ = (s) => document.querySelector(s)
let temporizador = null

const FASES_REF = {
  ...FASES, escenas: 'detectando cortes', audio: 'midiendo sonoridad',
  color: 'midiendo color', imagenes: 'extrayendo imágenes'
}

function medidas (m) {
  if (!m) return ''
  const f = m.formato || {}, r = m.ritmo || {}, a = m.audio || {}, c = m.color || {}
  const filas = [
    ['formato', `${f.ancho}×${f.alto} · ${f.fps} fps · ${f.vertical ? 'vertical' : 'horizontal'}`],
    ['ritmo', `${r.cortes} cortes · plano medio ${r.planoMedio}s`],
    ['habla', `${m.habla?.palabrasPorMinuto || 0} palabras por minuto`],
    ['audio', a.lufs != null ? `${a.lufs} LUFS · rango ${a.rango}` : '—'],
    ['color', c.saturacionMedia != null ? `saturación ${c.saturacionMedia} · brillo ${c.brilloMedio}` : '—']
  ]
  return `<table style="border-collapse:collapse;font-size:12.5px;margin-top:8px">${
    filas.map(([k, v]) => `<tr><td style="color:var(--suave);padding:2px 14px 2px 0">${k}</td><td>${escapar(v)}</td></tr>`).join('')}</table>`
}

function tarjeta (r) {
  const enCurso = !['listo', 'error', 'sin-ingest'].includes(r.fase)
  return `<div class="panel" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:12px">
      <b style="flex:1">${escapar(r.titulo)}</b>
      <span class="chip" style="${r.fase === 'error' ? 'color:var(--corte)' : r.fase === 'listo' ? 'color:var(--ok)' : ''}">${FASES_REF[r.fase] || r.fase}</span>
      <button data-ver="${escapar(r.slug)}">ver imágenes</button>
      <button data-borrar="${escapar(r.slug)}">&#10005;</button>
    </div>
    <div class="meta">${mmss(r.duracion)}${r.tieneEstilo ? ' · perfil de estilo escrito' : ''}</div>
    ${enCurso ? `<div class="barra"><i style="width:${r.progreso}%"></i></div>` : ''}
    ${medidas(r.medidas)}
    <div class="hueco" data-hueco="${escapar(r.slug)}"></div>
  </div>`
}

async function verImagenes (slug, hueco) {
  if (hueco.innerHTML) { hueco.innerHTML = ''; return }
  const d = await api(`/api/referencias/${encodeURIComponent(slug)}`)
  const img = d.medidas?.imagenes
  if (!img) { hueco.innerHTML = '<div class="meta">Todavía no hay imágenes.</div>'; return }
  const url = (c, f) => `/api/referencias/${encodeURIComponent(slug)}/img/${c}/${encodeURIComponent(f)}`
  hueco.innerHTML = `
    <h2 style="margin-top:16px">Hojas de contacto <span class="meta">(${img.fpsHoja} por segundo, rejilla ${img.columnas}×${img.filas})</span></h2>
    ${img.hojas.map(f => `<img src="${url('hojas', f)}" style="width:100%;border-radius:9px;margin-bottom:10px">`).join('')}
    <h2 style="margin-top:16px">Recortes de la zona del subtítulo <span class="meta">(sin escalar)</span></h2>
    <div class="grilla">${img.recortes.map(f => `<img src="${url('subtitulos', f)}" style="width:100%;border-radius:7px">`).join('')}</div>`
}

async function pintar () {
  const rs = await api('/api/referencias')
  $('#lista').innerHTML = rs.length ? rs.map(tarjeta).join('')
    : '<div class="vacio">Sin referencias. Pega la ruta de un video corto arriba.</div>'

  document.querySelectorAll('[data-ver]').forEach(b => b.onclick = () =>
    verImagenes(b.dataset.ver, document.querySelector(`[data-hueco="${b.dataset.ver}"]`)))
  document.querySelectorAll('[data-borrar]').forEach(b => b.onclick = async () => {
    if (!confirm(`¿Borrar la referencia "${b.dataset.borrar}"? El video no se toca.`)) return
    await api(`/api/referencias/${encodeURIComponent(b.dataset.borrar)}`, { method: 'DELETE' })
    pintar()
  })

  clearTimeout(temporizador)
  if (rs.some(r => !['listo', 'error', 'sin-ingest'].includes(r.fase))) temporizador = setTimeout(pintar, 1500)
}

$('#btnCrear').onclick = async () => {
  const ruta = $('#ruta').value.trim()
  if (!ruta) return
  $('#btnCrear').disabled = true
  try {
    await api('/api/referencias', { method: 'POST', body: JSON.stringify({ titulo: $('#titulo').value, videoPath: ruta }) })
    $('#ruta').value = ''; $('#titulo').value = ''
    pintar()
  } catch (e) { alert(e.message) } finally { $('#btnCrear').disabled = false }
}

$('#btnRevision').onclick = async () => {
  const b = $('#btnRevision'); b.disabled = true
  try {
    const r = await api('/api/proyectos/referencias/pedir-revision', { method: 'POST' })
    alert(r.sinCambios ? 'No había cambios nuevos.' : `Subido. Commit ${r.commit}`)
  } catch (e) { alert(e.message) } finally { b.disabled = false }
}

pintar()
