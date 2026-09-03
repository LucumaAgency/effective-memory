import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// No instalamos un navegador: usamos el que ya hay. En Windows siempre hay Edge,
// que es Chromium y sirve igual para el protocolo de depuracion.
const CANDIDATOS = () => {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return [
    process.env.NAVEGADOR,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean)
}

// Ultimo recurso: el chromium que deja playwright, si esta instalado.
function desdePlaywright () {
  const raiz = path.join(os.homedir(), '.cache', 'ms-playwright')
  if (!fs.existsSync(raiz)) return null
  for (const d of fs.readdirSync(raiz).filter(x => x.startsWith('chromium')).sort().reverse()) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell',
      'chrome-win/chrome.exe', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const f = path.join(raiz, d, rel)
      if (fs.existsSync(f)) return f
    }
  }
  return null
}

let cacheado
export function buscarNavegador () {
  if (cacheado !== undefined) return cacheado
  cacheado = CANDIDATOS().find(f => { try { return fs.existsSync(f) } catch { return false } })
    || desdePlaywright() || null
  return cacheado
}
