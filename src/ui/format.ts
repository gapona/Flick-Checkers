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
