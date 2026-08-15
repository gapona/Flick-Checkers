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
