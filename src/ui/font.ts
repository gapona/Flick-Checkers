/**
 * Optional display-font loader. A game opts in by calling `initDisplayFont({ family, url })`
 * once, before `new Phaser.Game(...)` — a Canvas/WebGL `Text` object does NOT retroactively
 * repaint when a web font finishes loading async after it already drew with a fallback face,
 * so this must resolve (or fail) before the first scene renders any text using it.
 *
 * Uses the browser `FontFace` API directly, not a CSS `@font-face`/CDN `<link>` — a CDN
 * request would be blocked by an offline-only CSP (e.g. YouTube Playables), so the font file
 * must be a local asset (`public/assets/fonts/...`) either way.
 *
 * This module intentionally ships with NO font baked in — `ui/theme.ts`'s `neonText()` reads
 * `getDisplayFontStack()`, which defaults to a plain system-sans stack until a game calls
 * `initDisplayFont()` with its own choice. Picking a specific font (weight, family, file) is
 * a per-game aesthetic decision, not something the shared UI kit should hardcode.
 */

export interface DisplayFontOptions {
  /** Font family name — passed to `FontFace()` and used verbatim in the resulting CSS stack. */
  family: string
  /** URL to a font file (`.woff2` recommended), loaded via `this.load.setPath`-independent `FontFace()` — not Phaser's own loader. */
  url: string
  /** CSS font-weight, e.g. `'700'` for a Bold-only static file. Omit for a variable/regular file. */
  weight?: string
}

const FALLBACK_STACK = 'Arial, sans-serif'

let currentStack = FALLBACK_STACK

/** The active display-font CSS stack — `'Arial, sans-serif'` until `initDisplayFont()`
 * resolves (or if it was never called, or failed). Read by `ui/theme.ts`'s `neonText()`; any
 * scene wanting the game's display font for a plain `Text` object should also read this
 * instead of hardcoding a family name. */
export function getDisplayFontStack(): string {
  return currentStack
}

/**
 * Loads `options.family` from `options.url` via the `FontFace` API and makes
 * `getDisplayFontStack()` return it from then on. Never throws — falls back to the system
 * sans-serif stack (already the default) on any failure, since a missing/broken display font
 * is a cosmetic degradation, not something that should block game boot.
 */
export async function initDisplayFont(options: DisplayFontOptions): Promise<void> {
  try {
    const face = new FontFace(options.family, `url(${options.url})`, options.weight ? { weight: options.weight } : undefined)
    const loaded = await face.load()
    document.fonts.add(loaded)
    currentStack = `'${options.family}', ${FALLBACK_STACK}`
  } catch (err) {
    console.warn('[font] failed to load display font, falling back to system sans-serif', err)
  }
}
