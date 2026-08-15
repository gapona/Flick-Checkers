// Post-build size/content guard, run automatically as part of `npm run build`.
// Nothing here talks to the network or a platform SDK -- it only inspects the dist/
// output that `vite build` just produced.
import { readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(ROOT, 'dist')

const MB = 1024 * 1024
const TOTAL_WARN_BYTES = 10 * MB
const TOTAL_FAIL_BYTES = 25 * MB
// Platform's own per-file limit is 30 MB (see PLAYABLES-SDK.md); 25 MB keeps a 5 MB
// margin so this guard trips before an actual submission would be rejected.
const FILE_FAIL_BYTES = 25 * MB

// Source-authoring formats that should never ship in a web build. Deliberately does NOT
// include audio/image delivery formats like .wav/.png/.mp3 -- this project already ships
// public/assets/audio/blip.wav as a real runtime asset, and a generic extension check
// can't tell a "WAV master" from a normal delivered sound file by extension alone. That
// distinction is a provenance/policy concern instead, enforced by
// public/assets/AUDIO-SOURCES.md and the CLAUDE.md rule requiring an entry for every
// audio file (see CLAUDE.md "Build Guards & Asset Policy").
const FORBIDDEN_SOURCE_EXTENSIONS = ['.psd', '.ai', '.sketch', '.fig', '.xcf', '.blend', '.aep']

function fail(message) {
  console.error(`[check-bundle] ${message}`)
  process.exitCode = 1
}

function collectFiles(dir, base = dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, base))
    } else if (entry.isFile()) {
      const size = statSync(fullPath).size
      files.push({ relPath: path.relative(base, fullPath).split(path.sep).join('/'), size })
    }
  }
  return files
}

function formatMB(bytes) {
  return `${(bytes / MB).toFixed(2)} MB`
}

if (!existsSync(DIST_DIR)) {
  console.error('[check-bundle] dist/ not found -- run "vite build" first.')
  process.exit(1)
}

const files = collectFiles(DIST_DIR)
const totalBytes = files.reduce((sum, f) => sum + f.size, 0)

const top10 = [...files].sort((a, b) => b.size - a.size).slice(0, 10)
console.log(`[check-bundle] top ${Math.min(10, top10.length)} largest files in dist/ (${files.length} total, ${formatMB(totalBytes)}):`)
console.table(top10.map((f) => ({ file: f.relPath, size: formatMB(f.size) })))

const oversizedFiles = files.filter((f) => f.size > FILE_FAIL_BYTES)
for (const f of oversizedFiles) {
  fail(`${f.relPath} is ${formatMB(f.size)}, over the ${formatMB(FILE_FAIL_BYTES)} per-file limit.`)
}

const forbiddenFiles = files.filter((f) => FORBIDDEN_SOURCE_EXTENSIONS.includes(path.extname(f.relPath).toLowerCase()))
for (const f of forbiddenFiles) {
  fail(`${f.relPath} looks like a source-authoring file, not a runtime asset -- it should never ship in dist/.`)
}

if (totalBytes > TOTAL_FAIL_BYTES) {
  fail(`dist/ totals ${formatMB(totalBytes)}, over the ${formatMB(TOTAL_FAIL_BYTES)} limit.`)
} else if (totalBytes > TOTAL_WARN_BYTES) {
  console.warn(`[check-bundle] warning: dist/ totals ${formatMB(totalBytes)}, over the ${formatMB(TOTAL_WARN_BYTES)} warning threshold.`)
}

if (process.exitCode) {
  console.error('[check-bundle] FAILED')
} else {
  console.log('[check-bundle] OK')
}
