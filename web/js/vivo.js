// Previa en vivo: el mismo HTML del grafico, en un iframe sobre el video, con su
// reloj atado al reproductor. Cero renders para iterar, y es exactamente el HTML
// que despues se quema, asi que no hay sorpresas entre la previa y el resultado.

export function montarEscenario (contenedor, { src, ancho, alto, maxAncho = 300 }) {
  contenedor.innerHTML = `<div class="escenario" style="aspect-ratio:${ancho}/${alto};max-width:${maxAncho}px">
      <video playsinline controls preload="metadata" src="${src}"></video>
      <div class="capa" style="width:${ancho}px;height:${alto}px"></div>
      <div class="capaSub"></div>
    </div>`
  const caja = contenedor.querySelector('.escenario')
  const video = contenedor.querySelector('video')
  const capa = contenedor.querySelector('.capa')
  const capaSub = contenedor.querySelector('.capaSub')

  // La capa se dibuja al tamano real del grafico y se escala: asi las medidas en
  // pixeles del HTML coinciden con las del render.
  const escalar = () => {
    const k = caja.clientWidth / ancho
    capa.style.transform = `scale(${k})`
    capaSub.style.fontSize = `${58 * k}px`
    capaSub.style.bottom = `${150 * k}px`
  }
  new ResizeObserver(escalar).observe(caja)
  escalar()

  return { caja, video, capa, capaSub, ancho, alto }
}

/** Un iframe por grafico, con su reloj movido a mano. */
export function montarGraficos (escenario, graficos, urlDe) {
  escenario.capa.innerHTML = ''
  const vivos = graficos.map(g => {
    const marco = document.createElement('iframe')
    marco.style.cssText = `position:absolute;left:${g.x || 0}px;top:${g.y || 0}px;` +
      `width:${g.ancho}px;height:${g.alto}px;visibility:hidden`
    marco.src = urlDe(g)
    escenario.capa.appendChild(marco)
    return { g, marco }
  })

  return function actualizar (tOriginal) {
    for (const { g, marco } of vivos) {
      const dentro = tOriginal >= g.in && tOriginal <= g.out
      marco.style.visibility = dentro ? 'visible' : 'hidden'
      if (!dentro) continue
      const doc = marco.contentDocument
      if (!doc) continue
      const ms = (tOriginal - g.in) * 1000
      for (const a of doc.getAnimations?.() || []) {
        try { a.pause(); a.currentTime = ms } catch { /* animacion no seekable */ }
      }
      if (typeof marco.contentWindow.dibujar === 'function') marco.contentWindow.dibujar(ms / 1000)
    }
  }
}

/** Subtitulos como HTML sobre el video: cambiar el estilo se ve al instante. */
export function montarSubtitulos (escenario, cues) {
  const span = document.createElement('span')
  escenario.capaSub.innerHTML = ''
  escenario.capaSub.appendChild(span)
  let ultimo

  return function actualizar (tOriginal) {
    const c = cues.find(x => tOriginal >= x.in && tOriginal <= x.out)
    if (c === ultimo) return
    ultimo = c
    span.textContent = c ? c.texto.replace(/\\N/g, '\n') : ''
    span.style.display = c ? '' : 'none'
  }
}
