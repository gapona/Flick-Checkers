import * as Phaser from 'phaser'
import { fitContain } from './fit'

// Phaser names the whole-image frame of any texture with no custom frames added `'__BASE'` —
// passing it explicitly (rather than the no-frame-argument `add.image(key)`/`setTexture(key)`
// shorthand) is always safe for a plain loaded image, and becomes load-bearing the moment a
// texture ever gets extra named frames added to it later (e.g. a sprite-sheet slicer that
// re-registers `firstFrame` to point at one of those instead of the whole image) — any preview
// built with no explicit frame after that silently renders a fragment, not the whole picture.
// Always use `makePreview()`/`setPreviewTexture()` below for a whole-image preview, never a raw
// `add.image()`, so this can't regress per call site.
const BASE_FRAME = '__BASE'

export type PreviewFit = 'contain' | 'cover'

/**
 * Creates an `Image` displaying `imageKey`'s whole texture, fit into `width x height`.
 * `fit: 'contain'` (default) scales down to fit with no cropping (letterboxed inside the box);
 * `'cover'` fills the box exactly, cropping any overflow.
 */
export function makePreview(scene: Phaser.Scene, imageKey: string, width: number, height: number, fit: PreviewFit = 'contain'): Phaser.GameObjects.Image {
  const image = scene.add.image(0, 0, imageKey, BASE_FRAME)
  applyPreviewFit(image, width, height, fit)
  return image
}

/** Repoints an existing preview `Image` at a different texture, keeping its current fit. */
export function setPreviewTexture(image: Phaser.GameObjects.Image, imageKey: string): void {
  image.setTexture(imageKey, BASE_FRAME)
}

/** Re-applies contain/cover sizing to an existing preview `Image` — call from the owning
 * scene's `layout()` on resize, same as any other sized UI element. */
export function applyPreviewFit(image: Phaser.GameObjects.Image, width: number, height: number, fit: PreviewFit = 'contain'): void {
  if (fit === 'contain') {
    image.setCrop()
    const { width: w, height: h } = fitContain(image.width, image.height, width, height)
    image.setDisplaySize(w, h)
    return
  }
  coverFitCrop(image, width, height)
}

/**
 * `'cover'` fit via `Image.setCrop()` rather than a `GeometryMask` — this Phaser build errors
 * ("Mask.setMask: not supported in WebGL") on masking an `Image` directly, and a crop achieves
 * the same visual result for a plain rectangular preview with no extra render pass. The crop
 * origin is deliberately always `(0, 0)` (never a centered/offset crop) — a real Phaser
 * rendering bug misplaces the visible region for a non-zero crop offset, confirmed by testing
 * a centered crop directly; cropping only from the near edge sidesteps it entirely.
 */
function coverFitCrop(image: Phaser.GameObjects.Image, boxWidth: number, boxHeight: number): void {
  const scale = Math.max(boxWidth / image.width, boxHeight / image.height)
  const cropWidth = boxWidth / scale
  const cropHeight = boxHeight / scale
  image.setCrop(0, 0, cropWidth, cropHeight)
  image.setDisplaySize(cropWidth * scale, cropHeight * scale)
}
