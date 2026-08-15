/**
 * A plain lookup-table i18n layer, not a library — `t(key, params?)` does `{name}` substitution
 * only; no plurals, no ICU MessageFormat, no locale-aware number/date formatting. Reach for a
 * real i18n library instead if a game ever needs those.
 *
 * This module ships as a FRAMEWORK, not a finished dictionary — the `en`/`es` objects below
 * hold only generic, cross-game UI strings (Settings/Close/Sound/...). A game adds its own
 * domain strings (menu copy, gameplay text, ...) by extending these same two objects; it must
 * NOT keep a second, parallel `t()` mechanism.
 *
 * `es` is typed as `Record<StringKey, string>` (`StringKey` derived FROM `en`'s own keys, not
 * hand-duplicated) — TypeScript's excess-property + missing-property checks on that assignment
 * mean `es` must have exactly the same key set as `en`, at compile time. A locale dictionary
 * silently drifting out of sync with the canonical `en` one (a key added to one but not the
 * other) is exactly the kind of bug that's invisible until a specific UI element renders
 * blank/wrong in one language — this makes it a build error instead. Extend both objects
 * together, in the same commit.
 */
import { getLanguage } from '../platform/yt'

export type Locale = 'en' | 'es'
export const DEFAULT_LOCALE: Locale = 'en'
const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'es']

const en = {
  settings: 'Settings',
  sound: 'Sound',
  music: 'Music',
  close: 'Close',
  back: 'Back',
  on: 'ON',
  off: 'OFF',
  shop: 'Shop',
  buy: 'Buy',
  owned: 'Owned',
  shopTopup: '\u{1F3AC} +{n} coins',
} as const

export type StringKey = keyof typeof en

const es: Record<StringKey, string> = {
  settings: 'Ajustes',
  sound: 'Sonido',
  music: 'Música',
  close: 'Cerrar',
  back: 'Atrás',
  on: 'SÍ',
  off: 'NO',
  shop: 'Tienda',
  buy: 'Comprar',
  owned: 'Comprado',
  shopTopup: '\u{1F3AC} +{n} monedas',
}

const STRINGS: Record<Locale, Record<StringKey, string>> = { en, es }

let currentLocale: Locale = DEFAULT_LOCALE

/**
 * BCP-47 prefix match: `'es-MX'` -> `'es'`, `'fr-FR'` -> `'fr'` -> not in `SUPPORTED_LOCALES`
 * -> falls back to `DEFAULT_LOCALE`. Written generically (not hardcoded to just `en`/`es`) so
 * adding a locale later is only a new dictionary object plus one entry in `SUPPORTED_LOCALES`.
 */
export function resolveLocale(raw: string): Locale {
  const prefix = raw.toLowerCase().split('-')[0]
  return (SUPPORTED_LOCALES as readonly string[]).includes(prefix) ? (prefix as Locale) : DEFAULT_LOCALE
}

/**
 * Called once from `main.ts`, before `new Phaser.Game(...)` (same timing as any other
 * boot-order-sensitive init) — a scene can read `t()` strings from its very first `create()`
 * call, so the locale has to already be resolved before that, not resolved lazily on first
 * use. `getLanguage()` itself never rejects (see `platform/yt.ts`), but this still guards with
 * a fallback rather than letting a hypothetical future throw there block game boot over a
 * cosmetic concern.
 */
export async function initLocale(): Promise<void> {
  try {
    currentLocale = resolveLocale(await getLanguage())
  } catch {
    currentLocale = DEFAULT_LOCALE
  }
}

/** The currently resolved locale (`DEFAULT_LOCALE` until `initLocale()` resolves). */
export function getLocale(): Locale {
  return currentLocale
}

function lookup(key: string): string | undefined {
  return (STRINGS[currentLocale] as Record<string, string>)[key] ?? (STRINGS[DEFAULT_LOCALE] as Record<string, string>)[key]
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole))
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  // lookup() can't actually miss for a real StringKey (both dictionaries are total over it,
  // enforced at compile time above) — the `?? key` is only a defensive fallback so a typo'd
  // key reads as visible mistranslated text in dev rather than throwing mid-scene.
  return interpolate(lookup(key) ?? key, params)
}

/**
 * For a dynamic, not-statically-known key (e.g. a generated/content-driven display-name key) —
 * returns `undefined` instead of the key itself on a miss, so a caller can fall back to its own
 * default (e.g. `?? rawId`) rather than displaying a raw dictionary key string.
 */
export function tOptional(key: string): string | undefined {
  return lookup(key)
}
