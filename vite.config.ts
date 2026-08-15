import { defineConfig, type Plugin } from 'vite'

/**
 * The Playables Test Suite's "SDK loaded before any game code" check watches actual
 * NETWORK load order, not DOM/script-tag order or JS execution order. A static
 * `<script type="module" src="...">` -- what Vite normally emits for the entry point --
 * is visible to the browser's *preload scanner*, which speculatively fetches it in
 * parallel with, not after, the classic blocking SDK `<script>` tag that precedes it in
 * the document. A small local bundle can finish downloading before the SDK's
 * network-round-trip-bound fetch does, failing the MUST check even though the tag order
 * (and the actual module's *execution* order, since module scripts are deferred) are both
 * already correct.
 *
 * Fix: rewrite the entry tag into a classic inline `<script>import("...")</script>`. A
 * dynamic `import()` call is invisible to the preload scanner -- it only scans HTML
 * attributes, not JS source -- so the fetch for the bundle can't start until this classic,
 * parser-blocking script actually executes, which (being positioned after the SDK's own
 * classic script) cannot happen before the SDK script has already finished loading and
 * running. Also strips any `<link rel="modulepreload">` Vite might emit for other
 * chunks -- those are equally visible to the preload scanner. There's only one chunk
 * today (nothing to strip), but this guards against a future code-split silently
 * reintroducing the same race.
 *
 * `apply: 'build'` + `enforce: 'post'`: only runs for `vite build` (dev serving is
 * untouched -- Vite manages its own module graph there, see CLAUDE.md "Build Guards &
 * Asset Policy"), and runs after Vite's own core HTML plugin has already injected the
 * entry `<script type="module">` tag this rewrites.
 */
function inlineModuleLoader(): Plugin {
  return {
    name: 'inline-module-loader',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      let out = html.replace(
        /<script type="module"([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g,
        (_match, _before, src) => `<script>import(${JSON.stringify(src)})</script>`,
      )
      out = out.replace(/<link\s+rel="modulepreload"[^>]*>\s*/gi, '')
      return out
    },
  }
}

export default defineConfig({
  // Playables does not host games at the domain root, so root-absolute asset paths
  // (Vite's default, e.g. `/assets/foo.js`) 404 there even though they work locally.
  // './' emits relative paths (`./assets/foo.js`) that resolve correctly regardless of
  // where the game is actually served from.
  base: './',
  plugins: [inlineModuleLoader()],
  server: {
    port: 8080,
    open: true,
  },
  build: {
    outDir: 'dist',
    // esbuild's default target predates top-level await, which src/main.ts relies on
    // to wait for the Playables SDK before constructing the Phaser.Game instance.
    target: 'es2022',
  },
})
