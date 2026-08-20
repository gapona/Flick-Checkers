/** Seconds -> `"M:SS"`. Locale-invariant (every timer/count in this kit is a plain digit, no
 * ICU/plural rules needed). */
export function formatTime(elapsedSec: number): string {
  const total = Math.round(elapsedSec)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** `'retro-tech'` -> `'Retro Tech'` — a generic fallback for any hyphenated id (asset key,
 * slug, etc.) that needs a human-readable label with no dedicated display name. */
export function titleCase(id: string): string {
  return id
    .split('-')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

/**
 * `'2026-08-20'` -> `'20 Aug'`, in the player's own language.
 *
 * **Formatted in UTC, and that is the whole reason this is a function rather than a call site.**
 * `daily/puzzle.ts` turns the day over at midnight UTC so that two players in different time zones
 * are never on different puzzles — which means the date a menu prints has to be the puzzle's day,
 * not the device's. Handing `new Date()` to a formatter with no `timeZone` gives the local day, and
 * for anybody east or west of UTC there is a window every night where the button would name one day
 * and the button would open another.
 *
 * Falls back to the raw key if `Intl` is unavailable or the string is not a date — a menu label is
 * never worth throwing over.
 */
export function formatDayKey(isoDay: string, locale: string): string {
  const at = Date.parse(`${isoDay}T00:00:00Z`)
  if (Number.isNaN(at)) return isoDay
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(at))
  } catch {
    return isoDay
  }
}
