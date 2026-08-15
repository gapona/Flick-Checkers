import * as Phaser from 'phaser'

const REFERENCE_WIDTH = 400
const MIN_UI_SCALE = 0.8

export const MIN_TOUCH_TARGET = 44

/**
 * Uniform scale factor for interactive UI at the given viewport width: 1 at/above
 * REFERENCE_WIDTH, floored at MIN_UI_SCALE below it — so text/buttons shrink
 * gracefully on narrow screens instead of collapsing.
 */
export function uiScale(width: number): number {
  return Phaser.Math.Clamp(width / REFERENCE_WIDTH, MIN_UI_SCALE, 1)
}

/**
 * Ensures an interactive object's tap target is at least `minSize` CSS px square,
 * centered on its current (possibly shrunk by uiScale) bounds — the object may render
 * smaller than that on narrow screens, but stays reliably tappable.
 *
 * Safe to call every `layout()` (including resizes): per Phaser's GameObject docs,
 * re-calling `setInteractive()` on an already-interactive object does NOT recompute
 * its hit area (it just re-enables the existing one) — so once `.input` exists, this
 * mutates the existing hit-area Rectangle in place instead.
 */
export function ensureMinHitArea(obj: Phaser.GameObjects.Text, minSize = MIN_TOUCH_TARGET): void {
  const w = Math.max(obj.width, minSize)
  const h = Math.max(obj.height, minSize)
  const x = (obj.width - w) / 2
  const y = (obj.height - h) / 2

  if (!obj.input) {
    obj.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(x, y, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    })
    return
  }

  ;(obj.input.hitArea as Phaser.Geom.Rectangle).setTo(x, y, w, h)
}
