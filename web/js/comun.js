export const api = async (ruta, opciones = {}) => {
  const r = await fetch(ruta, {
    ...opciones,
    headers: opciones.body ? { 'Content-Type': 'application/json' } : undefined
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}

export const mmss = (t) => {
  if (!isFinite(t)) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export const FASES = {
  'sin-ingest': 'sin procesar',
  'en-cola': 'en cola',
  sondeando: 'leyendo video',
  silencios: 'detectando silencios',
  frames: 'extrayendo frames',
  'descargando-modelo': 'descargando el modelo de Whisper',
  transcribiendo: 'transcribiendo',
  listo: 'listo',
  error: 'error'
}

export const escapar = (s) => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
