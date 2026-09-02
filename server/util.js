import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function correr (cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, windowsHide: true })
    let out = '', err = ''
    p.stdout?.on('data', d => { out += d })
    p.stderr?.on('data', d => { err += d; opts.onStderr?.(d.toString()) })
    p.on('error', e => reject(new Error(`No se pudo ejecutar "${cmd}": ${e.message}`)))
    p.on('close', code => code === 0
      ? resolve({ out, err })
      : reject(Object.assign(new Error(`${cmd} salio con codigo ${code}\n${err.slice(-2000)}`), { code, out, err })))
  })
}

export const leerJson = (f, def = null) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return def }
}

export const escribirJson = (f, datos) => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(datos, null, 2) + '\n', 'utf8')
}

export const slugify = (s) => s.toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 60) || 'proyecto'

export const hhmmss = (t) => {
  const s = Math.max(0, t)
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`
}
