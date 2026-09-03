// Timeline editable sobre la linea de tiempo del ORIGINAL.
// No es un editor de video: es una vista con manijas sobre los JSON que ya existen.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export function crearTimeline (elemento, opciones) {
  const est = {
    duracion: opciones.duracion || 0,
    desde: 0,
    hasta: opciones.duracion || 0,
    palabras: [],      // para imantar
    pistas: [],        // [{ clave, etiqueta, items:[{id,in,out,color,titulo}] , alEditar }]
    fondos: { silencios: [], voz: [] },
    onda: opciones.onda || null,
    tiempo: 0,
    alBuscar: opciones.alBuscar || (() => {})
  }

  const el = elemento
  el.classList.add('tl')
  el.innerHTML = `
    <div class="tl-barra">
      <button data-zoom="-1" title="Alejar">−</button>
      <button data-zoom="1" title="Acercar">+</button>
      <button data-zoom="0" title="Ver todo">todo</button>
      <span class="tl-rango meta"></span>
      <span style="flex:1"></span>
      <label class="meta"><input type="checkbox" class="tl-iman" checked> imantar a palabras</label>
    </div>
    <div class="tl-lienzo">
      <div class="tl-onda"></div>
      <div class="tl-fondo"></div>
      <div class="tl-pistas"></div>
      <div class="tl-cabeza"></div>
    </div>`

  const lienzo = el.querySelector('.tl-lienzo')
  const aX = (t) => ((t - est.desde) / Math.max(0.001, est.hasta - est.desde)) * 100
  const aT = (px) => {
    const r = lienzo.getBoundingClientRect()
    return est.desde + ((px - r.left) / r.width) * (est.hasta - est.desde)
  }

  /** Imanta a la palabra mas cercana: cortar a media silaba es el error tipico. */
  function imantar (t) {
    if (!el.querySelector('.tl-iman').checked || !est.palabras.length) return t
    const ventana = (est.hasta - est.desde) * 0.02      // 2% del zoom actual
    let mejor = t, dist = ventana
    for (const w of est.palabras) {
      for (const cand of [w.in, w.out]) {
        const d = Math.abs(cand - t)
        if (d < dist) { dist = d; mejor = cand }
      }
    }
    return +mejor.toFixed(3)
  }

  function pintar () {
    el.querySelector('.tl-rango').textContent =
      `${est.desde.toFixed(1)}s → ${est.hasta.toFixed(1)}s`

    // La onda cubre el video entero; al hacer zoom se escala y se desplaza.
    // Con background-position en %, el desplazamiento correcto es
    // desde / (duracion - ventana): alinea ese punto de la imagen con el mismo
    // punto del contenedor.
    const onda = el.querySelector('.tl-onda')
    if (est.onda && est.duracion) {
      const ventana = Math.max(0.001, est.hasta - est.desde)
      const escala = est.duracion / ventana
      onda.style.backgroundImage = `url(${est.onda})`
      onda.style.backgroundSize = `${escala * 100}% 100%`
      onda.style.backgroundPositionX = est.duracion > ventana
        ? `${(est.desde / (est.duracion - ventana)) * 100}%`
        : '0%'
    }

    el.querySelector('.tl-fondo').innerHTML =
      est.fondos.silencios.map(s => `<div class="tl-sil" style="left:${aX(s.in)}%;width:${aX(s.out) - aX(s.in)}%"></div>`).join('') +
      est.fondos.voz.map(s => `<div class="tl-voz" style="left:${aX(s.in)}%;width:${aX(s.out) - aX(s.in)}%"></div>`).join('')

    el.querySelector('.tl-pistas').innerHTML = est.pistas.map((p, i) => `
      <div class="tl-pista" data-pista="${i}">
        <span class="tl-etiqueta">${p.etiqueta}</span>
        ${p.items.map(it => {
          const x = aX(it.in), w = aX(it.out) - aX(it.in)
          if (x > 100 || x + w < 0) return ''
          return `<div class="tl-bloque" data-item="${it.id}" style="left:${x}%;width:${w}%;background:${it.color || 'var(--acento)'}">
            <span class="tl-manija izq" data-borde="in"></span>
            <span class="tl-titulo">${it.titulo || it.id}</span>
            <span class="tl-manija der" data-borde="out"></span>
          </div>`
        }).join('')}
      </div>`).join('')

    el.querySelector('.tl-cabeza').style.left = aX(est.tiempo) + '%'
    conectarArrastre()
  }

  function conectarArrastre () {
    el.querySelectorAll('.tl-manija').forEach(m => {
      m.onpointerdown = (ev) => {
        ev.preventDefault(); ev.stopPropagation()
        const bloque = m.closest('.tl-bloque')
        const pista = est.pistas[Number(bloque.closest('.tl-pista').dataset.pista)]
        const item = pista.items.find(x => String(x.id) === bloque.dataset.item)
        const borde = m.dataset.borde
        m.setPointerCapture(ev.pointerId)
        el.classList.add('tl-arrastrando')

        const mover = (e) => {
          const t = imantar(clamp(aT(e.clientX), 0, est.duracion))
          if (borde === 'in') item.in = Math.min(t, item.out - 0.3)
          else item.out = Math.max(t, item.in + 0.3)
          pintar()
        }
        const soltar = async (e) => {
          m.releasePointerCapture?.(ev.pointerId)
          el.classList.remove('tl-arrastrando')
          window.removeEventListener('pointermove', mover)
          window.removeEventListener('pointerup', soltar)
          await pista.alEditar?.(item, borde)
        }
        window.addEventListener('pointermove', mover)
        window.addEventListener('pointerup', soltar)
      }
    })
  }

  lienzo.addEventListener('click', (e) => {
    if (e.target.closest('.tl-bloque')) return
    est.alBuscar(clamp(aT(e.clientX), 0, est.duracion))
  })

  lienzo.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
    e.preventDefault()
    const centro = aT(e.clientX)
    const factor = e.deltaY > 0 ? 1.25 : 0.8
    const ancho = clamp((est.hasta - est.desde) * factor, 1, est.duracion)
    est.desde = clamp(centro - (centro - est.desde) * factor, 0, est.duracion - ancho)
    est.hasta = est.desde + ancho
    pintar()
  }, { passive: false })

  el.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => {
    const z = Number(b.dataset.zoom)
    if (z === 0) { est.desde = 0; est.hasta = est.duracion }
    else {
      const centro = est.tiempo || (est.desde + est.hasta) / 2
      const ancho = clamp((est.hasta - est.desde) * (z > 0 ? 0.6 : 1.7), 1, est.duracion)
      est.desde = clamp(centro - ancho / 2, 0, est.duracion - ancho)
      est.hasta = est.desde + ancho
    }
    pintar()
  })

  return {
    estado: est,
    configurar (parcial) { Object.assign(est, parcial); pintar() },
    marcarTiempo (t) {
      est.tiempo = t
      const cabeza = el.querySelector('.tl-cabeza')
      if (cabeza) cabeza.style.left = aX(t) + '%'
    },
    pintar
  }
}
