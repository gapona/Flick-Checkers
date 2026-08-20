// Post-build size/content guard, run automatically as part of `npm run build`.
// Nothing here talks to the network or a platform SDK -- it only inspects the dist/
// output that `vite build` just produced.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
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
// include audio/image delivery formats like .wav/.png/.mp3 -- a generic extension check
// can't tell a "WAV master" from a normal delivered sound file by extension alone. That
// distinction is a provenance concern instead, enforced by the registry check below.
const FORBIDDEN_SOURCE_EXTENSIONS = ['.psd', '.ai', '.sketch', '.fig', '.xcf', '.blend', '.aep']

/**
 * Provenance gates. CLAUDE.md requires a registry row for every audio file and every font that
 * ships, because an unresolved copyright claim on either is one of the most common Playables
 * rejection reasons -- until S10 that was a process rule nobody could enforce, and a process rule
 * with no gate is a rule that holds right up until the day someone is in a hurry.
 *
 * The check is deliberately dumb: the registry is prose, and all this asks is that the shipped
 * file's name appears in it. It cannot tell a truthful row from a careless one; what it CAN do is
 * make adding a file without thinking about its licence impossible to do silently.
 */
/**
 * Strings that exist only inside `import.meta.env.DEV` branches, and must therefore be ABSENT from
 * a production bundle.
 *
 * `import.meta.env.DEV` is substituted with `false` at build time and the branch is dropped — but
 * "is dropped" is a claim about the bundler, and the two things behind it are a debug readout drawn
 * over live gameplay and a whole widget-stand scene. A reviewer opening the shipped game and seeing
 * a frame counter over the board is a certification problem, not a cosmetic one.
 *
 * Each entry is a literal distinctive enough that finding it means the branch survived. Keep them
 * in step with the code that owns them.
 */
const DEV_ONLY_LITERALS = [
  // `scenes/Game.ts`'s debug readout — the label of its first line, spacing included.
  'fps    ',
  // `scenes/UiStand.ts`, reachable only through `window.__ui()`.
  'plum · long label',
]

const PROVENANCE_REGISTRIES = [
  { extensions: ['.ogg', '.wav', '.mp3', '.m4a', '.webm'], registry: 'AUDIO-SOURCES.md', kind: 'audio' },
  { extensions: ['.woff2', '.woff', '.ttf', '.otf'], registry: 'FONT-SOURCES.md', kind: 'font' },
  // Images joined this list late, and for a specific reason: until the backgrounds became
  // diffusion renders, every pixel in the repo was computed by `scripts/make-atlas.mjs`, so a
  // gate would only ever have confirmed what the generator already guaranteed. The moment ONE
  // shipped image stopped being arithmetic, the gate started earning its keep — and it has to
  // cover all of them, not just the exception, or it only checks the files nobody worried about.
  { extensions: ['.webp', '.png', '.jpg', '.jpeg', '.avif', '.gif', '.svg'], registry: 'ART-SOURCES.md', kind: 'image' },
]

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

const scripts = files.filter((f) => f.relPath.endsWith('.js'))
for (const literal of DEV_ONLY_LITERALS) {
  for (const file of scripts) {
    if (readFileSync(path.join(DIST_DIR, file.relPath), 'utf8').includes(literal)) {
      fail(`${file.relPath} contains the DEV-only literal ${JSON.stringify(literal)} — an import.meta.env.DEV branch survived into the production bundle.`)
    }
  }
}

for (const { extensions, registry, kind } of PROVENANCE_REGISTRIES) {
  const shipped = files.filter((f) => extensions.includes(path.extname(f.relPath).toLowerCase()))
  if (shipped.length === 0) continue

  const registryPath = path.join(ROOT, registry)
  if (!existsSync(registryPath)) {
    fail(`dist/ ships ${shipped.length} ${kind} file(s) but ${registry} is missing.`)
    continue
  }
  const text = readFileSync(registryPath, 'utf8')
  for (const file of shipped) {
    // Matched on basename: the registry lists paths relative to `public/assets/`, while dist/
    // paths are relative to the bundle root, and only the filename is common to both.
    if (!text.includes(path.basename(file.relPath))) {
      fail(`${file.relPath} ships without a row in ${registry} — only CC0 or self-generated ${kind} may be added, and the row goes in first.`)
    }
  }
}

/**
 * Portal metadata, checked here because the portal rejects it at the END of the submission flow
 * (PLAYABLES-SDK.md: title <= 50 chars, description <= 150, genre from a fixed list) and a
 * character count is the silliest possible reason to make that round trip twice. `store/` is
 * submission material and never ships — it lives outside `public/` for the same reason
 * AUDIO-SOURCES.md does.
 */
const GENRES = ['Action', 'Arcade', 'Brain and Puzzle', 'Board and Card', 'Music', 'Racing', 'RPG and Strategy', 'Simulation', 'Sports', 'Trivia and Word']
const metadataPath = path.join(ROOT, 'store/metadata.json')
if (existsSync(metadataPath)) {
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  if (!metadata.title || metadata.title.length > 50) fail(`store/metadata.json: title is ${metadata.title?.length ?? 0} chars, the portal allows 50.`)
  if (!metadata.description || metadata.description.length > 150) fail(`store/metadata.json: description is ${metadata.description?.length ?? 0} chars, the portal allows 150.`)
  if (!GENRES.includes(metadata.genre)) fail(`store/metadata.json: "${metadata.genre}" is not one of the portal's genres.`)
  for (const [aspect, file] of Object.entries(metadata.thumbnails ?? {})) {
    if (!existsSync(path.join(ROOT, 'store', file))) fail(`store/metadata.json: the ${aspect} thumbnail "${file}" does not exist.`)
  }
} else {
  // Not a warning yet: there is nothing to describe until the game exists (CHAPAEV-PLAN.md §10,
  // S13). The validation above is kept live regardless, so the file is checked from the moment it
  // is first written rather than on the day of the submission it would block.
  console.log('[check-bundle] store/metadata.json not present yet — portal metadata lands with S13.')
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
