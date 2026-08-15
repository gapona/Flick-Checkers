// Builds the YouTube Playables submission ZIP from an already-built dist/. Run via
// `npm run bundle` (which runs `npm run build` first) -- this script alone does not build.
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(ROOT, 'dist')
const BUILD_DIR = path.join(ROOT, 'build')
const INDEX_HTML = path.join(DIST_DIR, 'index.html')

// Per PLAYABLES-SDK.md: the SDK script must load before any game code, and certification
// checks for this specifically -- so the ZIP-building step re-verifies it on the actual
// built output, not just trusting that index.html's source looked right.
const SDK_SCRIPT_SRC = 'https://www.youtube.com/game_api/v1'

function fail(message) {
  console.error(`[make-bundle] ${message}`)
  process.exit(1)
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

if (!existsSync(DIST_DIR)) {
  fail('dist/ not found -- run "npm run build" first.')
}

if (!existsSync(INDEX_HTML)) {
  fail('dist/index.html not found at the dist root -- Playables requires index.html at the archive root, not in a subfolder.')
}

const html = readFileSync(INDEX_HTML, 'utf8')

const sdkIndex = html.indexOf(SDK_SCRIPT_SRC)
if (sdkIndex === -1) {
  fail(`dist/index.html is missing the Playables SDK script tag (<script src="${SDK_SCRIPT_SRC}">).`)
}

// The entry point must NOT be a static <script type="module" src="..."> -- that's visible
// to the browser's preload scanner, which fetches it in parallel with (not after) the
// classic blocking SDK script, defeating the point of the tag order: the Test Suite checks
// actual network load order, not DOM order, and a fast local asset can finish downloading
// before the SDK's network-round-trip-bound fetch does. vite.config.ts's
// `inlineModuleLoader` plugin rewrites Vite's default output into a classic inline
// `<script>import(...)</script>` specifically to avoid this -- see CLAUDE.md "Build Guards
// & Asset Policy".
const staticModuleScriptMatch = html.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["'][^"']+["']/i)
if (staticModuleScriptMatch) {
  fail(
    'dist/index.html has a static <script type="module" src="..."> entry -- this races the ' +
      "SDK script over the network via the browser's preload scanner. It should have been rewritten to an " +
      'inline import() loader by the inlineModuleLoader Vite plugin.',
  )
}

const modulePreloadMatch = html.match(/<link\b[^>]*\brel=["']modulepreload["']/i)
if (modulePreloadMatch) {
  fail(
    'dist/index.html has a <link rel="modulepreload"> tag -- these are also visible to the ' +
      "preload scanner and can race the SDK script the same way a static module script does. The " +
      'inlineModuleLoader Vite plugin should have stripped it.',
  )
}

const inlineLoaderMatch = html.match(/<script>\s*import\(/)
if (!inlineLoaderMatch) {
  fail('dist/index.html has no inline `<script>import(...)</script>` entry loader.')
}

if (sdkIndex > inlineLoaderMatch.index) {
  fail('The Playables SDK <script> tag must appear before the inline import() loader in dist/index.html.')
}

// Regression guard: Playables does not host games at the domain root, so a root-absolute
// path (Vite's default `base`, e.g. `src="/assets/foo.js"`) 404s there even though it
// works fine locally -- this exact bug shipped once (see CLAUDE.md "Known Issues Fixed")
// because check-bundle.mjs validates size/content but nothing previously validated path
// *shape*. `(?!\/)` excludes protocol-relative `//host/...` URLs, which are fine.
const absolutePathMatches = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](\/(?!\/)[^"']*)["']/gi)]
if (absolutePathMatches.length > 0) {
  fail(
    `dist/index.html references root-absolute path(s): ${absolutePathMatches.map((m) => m[1]).join(', ')} -- ` +
      `set base: './' in vite.config.ts so asset paths are relative.`,
  )
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const appId = slugify(pkg.name)
const zipName = `${appId}-${pkg.version}.zip`

mkdirSync(BUILD_DIR, { recursive: true })
const zipPath = path.join(BUILD_DIR, zipName)

const output = createWriteStream(zipPath)
const archive = new ZipArchive({ zlib: { level: 9 } })

output.on('close', () => {
  console.log(`[make-bundle] wrote ${path.relative(ROOT, zipPath)} (${(archive.pointer() / (1024 * 1024)).toFixed(2)} MB)`)
})

archive.on('warning', (err) => {
  throw err
})
archive.on('error', (err) => {
  throw err
})

archive.pipe(output)
// `false` as the destination flattens dist/'s contents to the archive root -- no
// wrapping "dist/" folder, so index.html ends up at the ZIP root as required. The third
// arg filters out repo-scaffolding files that end up in dist/ via the public/ copy but
// have no purpose in a submission archive (e.g. `.gitkeep` placeholders for git, which
// can't track empty directories) -- returning `false` excludes the matched entry.
archive.directory(DIST_DIR, false, (entry) => (path.basename(entry.name) === '.gitkeep' ? false : entry))
archive.finalize()
