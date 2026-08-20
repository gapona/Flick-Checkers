/**
 * This game's own palette + display font — the single place the "glossy mobile casual" art
 * direction of CONCEPT.md §6 is expressed as concrete values.
 *
 * Why a separate module instead of calling `setTheme()` inline in `main.ts`: `config.ts`'s
 * `backgroundColor` needs the same `backgroundTop` value, and `GameConfig` is a module-level
 * const evaluated at *import* time — i.e. before `main.ts`'s own body (and therefore before any
 * `setTheme()` call) ever runs. Reading `getTheme()` from `config.ts` would silently pick up
 * `DEFAULT_THEME`'s neon palette instead. Both consumers read this plain exported const, so the
 * order they're imported in can't matter.
 */
import { setTheme, type ThemeConfig } from './ui/theme'
import type { DisplayFontOptions } from './ui/font'

/**
 * Gold + deep plum, per CONCEPT.md §6:
 * - Gold is the ONLY metal in this game (frames, button rims, coins, the king's crown). Two
 *   slots are in that family on purpose and are not interchangeable: `accent` is the bright
 *   coin gold reserved for currency/reward iconography (`valueBadge()` defaults to it), while
 *   `primary` is the warmer amber the loudest CTA is built from — keeping them a step apart in
 *   hue/value is what stops "this is a reward" from reading the same as "this is a button".
 * - `secondary` is deliberately NOT a metal: it's the violet for secondary/quieter actions,
 *   which is what keeps gold meaning "important" rather than meaning "interactive".
 * - The deep plum background is functional, not decorative — gold and the saturated piece
 *   colors read against it and drown on a light ground.
 *
 * `backgroundTop` has two hand-synced copies outside this file: `config.ts`'s
 * `backgroundColor` (imported from here, so it can't drift) and `index.html`'s `body`
 * background (a literal — HTML can't import a TS const; it's what shows before the canvas
 * exists, so a stale value there reads as a flash on boot).
 */
export const GAME_THEME: ThemeConfig = {
  colors: {
    primary: 0xff9d21,
    secondary: 0xa367ff,
    accent: 0xffcf3f,
    backgroundTop: 0x3d1160,
    backgroundBottom: 0x180528,
    surface: 0x2b0c42,
  },
  // Rounder than the kit's default 10: this style's buttons are pills with a visible bottom
  // "thickness", not thin-stroked rectangles.
  radius: 14,
}

/**
 * Heavy rounded grotesque (CONCEPT.md §6, "Интерфейс → Текст"). Latin subset only — the game
 * ships `en`/`es` (`i18n/strings.ts`), both fully covered by U+0000-00FF plus the handful of
 * punctuation glyphs in that subset, so the latin-ext/hebrew subsets Google serves separately
 * would be pure bundle weight. Local file, never a CDN `<link>`: Playables' CSP blocks external
 * hosts. Provenance/license: `FONT-SOURCES.md`.
 */
export const DISPLAY_FONT: DisplayFontOptions = {
  family: 'Fredoka',
  // Relative, not root-absolute — Playables does not host games at the domain root (see
  // CLAUDE.md "Build Guards & Asset Policy").
  url: 'assets/fonts/fredoka-600-latin.woff2',
  weight: '600',
}

/** Installs {@link GAME_THEME} into `ui/theme.ts`. Call once at boot, before `new
 * Phaser.Game(...)` — every widget factory reads the theme at creation time, not reactively. */
export function applyGameTheme(): void {
  setTheme(GAME_THEME)
}
