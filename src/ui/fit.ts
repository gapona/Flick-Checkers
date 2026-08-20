/**
 * Largest width/height that fits `sourceWidth x sourceHeight` inside `maxWidth x maxHeight`
 * without distorting the aspect ratio ("contain", not "cover"). Shared by any preview/thumbnail
 * that needs to show a whole image inside a fixed box — see `ui/preview.ts`.
 */
export function fitContain(sourceWidth: number, sourceHeight: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) return { width: 0, height: 0 }
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)
  return { width: sourceWidth * scale, height: sourceHeight * scale }
}

/**
 * Shrink-to-fit factor: `1` when something already fits, otherwise the factor that makes it fit.
 * **Never grows** — a headline that happens to be short should not balloon to fill the screen.
 *
 * Used for text that must not clip on a narrow viewport (`uiScale` alone cannot do this: it floors
 * at 0.8 and knows nothing about how wide a particular string renders).
 *
 * `safety` (default 0.95) shaves a little off the available width, because a `Text`'s reported
 * width is its glyph box and `neonText`'s glow copy bleeds a few pixels past it. It is a small
 * margin on purpose: Phaser's measurement is otherwise accurate — checked against the DOM's own
 * `measureText` for the display font, which agreed exactly.
 */
export function fitScale(naturalWidth: number, availableWidth: number, safety = 0.95): number {
  if (naturalWidth <= 0 || availableWidth <= 0) return 1
  return Math.min(1, (availableWidth * safety) / naturalWidth)
}
