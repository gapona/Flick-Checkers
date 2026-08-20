import * as Phaser from 'phaser'
import { uiScale } from './uiScale'

/**
 * The scrim and panel every overlay scene is built on.
 *
 * Three separate defects it exists to make impossible, all of which the game shipped with:
 *
 * 1. **No dimming.** An overlay drawn straight onto the live scene competes with it — on the
 *    result panel the board was still legible behind the numbers, and the eye has no idea which
 *    layer it is meant to be reading.
 * 2. **Clicks passing through.** A panel that merely draws on top leaves everything under it
 *    pressable. Here the opener is `scene.pause()`d, which stops its input plugin outright, so the
 *    blocking is already done before this module is involved — see the scrim's own note for why it
 *    deliberately does NOT take input to achieve it.
 * 3. **No way back.** `Escape` and a tap outside are what people try first; both are wired here
 *    once instead of in each overlay, badly.
 *
 * The one deliberate exception is {@link OverlayOptions.dismissible}: the result panel does not
 * close on a tap outside, because a stray tap must not be able to skip the outcome of a round.
 */

const SCRIM_COLOR = 0x0a0612
const SCRIM_ALPHA = 0.72
const SCRIM_FADE_MS = 120
/** The panel arrives from slightly under its own size and overshoots — near enough to 1 that it
 * reads as a snap rather than a zoom. */
const PANEL_FROM_SCALE = 0.92
const PANEL_IN_MS = 220
const PANEL_OUT_MS = 100
/**
 * The panel's own fill, exported because a scrolling overlay has to repaint it itself.
 *
 * A scroll region clips through a dedicated camera's VIEWPORT, and a later camera does not
 * composite over an earlier one — it OWNS those pixels (see "Scroll Patterns"). So the plate this
 * module draws on `cameras.main` is simply absent inside the region's rectangle, and the region has
 * to carry the same colour as its own camera background or the list appears to float on the scrim.
 */
export const OVERLAY_PANEL_FILL = 0x210c36
const PANEL_FILL = OVERLAY_PANEL_FILL
const PANEL_CONTOUR = 0x120520
const PANEL_RADIUS = 22

export interface OverlayOptions {
  /** `false` for a panel that must be dismissed by a real choice — see the class comment. */
  dismissible?: boolean
  /** Called by a tap on the scrim. Only ever fires when `dismissible` is not `false`. */
  onDismiss?: () => void
}

export interface Overlay {
  /** The scrim, for a caller that needs to add it to a camera set. */
  readonly scrim: Phaser.GameObjects.Rectangle
  /** Put panel content in here — it is what scales in, and it is positioned by {@link layout}. */
  readonly panel: Phaser.GameObjects.Container
  /** Draws the panel's own plate at the given size, centred. Call from `layout()` once the content
   * has told the scene how big it needs to be. */
  drawPanel(width: number, height: number, scale: number, accent?: number): void
  layout(width: number, height: number): void
  /** Fades the scrim in and springs the panel. Safe to call once, from `create()`. */
  open(): void
  /** Reverses it, then calls `done` — the caller stops its own scene there, so the overlay is
   * never yanked off screen mid-tween. */
  close(done: () => void): void
  destroy(): void
}

export function createOverlay(scene: Phaser.Scene, options: OverlayOptions = {}): Overlay {
  /**
   * **Not interactive**, and that is a fix rather than an omission.
   *
   * A full-screen interactive rectangle at scene level competes with the panel's own controls for
   * every tap, and in Phaser it WINS: the input sort ranks candidates by their index in their own
   * display list, and a child of a container is indexed inside that container — so a slider at
   * container index 4 sorts below a scrim at scene index 0, and the scrim swallows the tap. The
   * symptom is silent and baffling: the panel renders, its controls highlight on hover, and nothing
   * responds. Both faders in `Settings` were dead this way.
   *
   * It does not need input anyway. The scene underneath is paused, which stops its input plugin, so
   * nothing can be clicked through to; and "tap outside to dismiss" is a question about WHERE the
   * tap was, which the scene-level handler below answers with a bounds test instead of by owning a
   * rectangle.
   */
  const scrim = scene.add
    .rectangle(0, 0, scene.scale.width, scene.scale.height, SCRIM_COLOR, SCRIM_ALPHA)
    .setOrigin(0.5)
    .setAlpha(0)

  const plate = scene.add.graphics()
  const panel = scene.add.container(0, 0, [plate])
  /** The panel's drawn size, kept so the dismiss test knows what "outside" means. */
  let panelWidth = 0
  let panelHeight = 0

  if (options.dismissible !== false && options.onDismiss) {
    /**
     * Dismissal is not armed until one pointer has been RELEASED.
     *
     * The tap that opens an overlay is still being dispatched when the overlay's own `create()`
     * runs: the launching button fires on POINTER_DOWN, the new scene registers its handlers, and
     * Phaser goes on delivering that same event to the scenes after it in the list. Without this
     * guard the overlay opened and closed on one tap — and it looked exactly like the button not
     * working, because the intermediate frame was never visible.
     */
    let armed = false
    const onUp = (): void => {
      armed = true
    }
    const onDown = (pointer: Phaser.Input.Pointer): void => {
      if (!armed) return
      const insideX = Math.abs(pointer.x - panel.x) <= panelWidth / 2
      const insideY = Math.abs(pointer.y - panel.y) <= panelHeight / 2
      if (insideX && insideY) return
      options.onDismiss?.()
    }
    scene.input.on(Phaser.Input.Events.POINTER_UP, onUp)
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDown)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.off(Phaser.Input.Events.POINTER_UP, onUp)
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, onDown)
    })
  }

  return {
    scrim,
    panel,
    drawPanel(width: number, height: number, scale: number, accent = PANEL_CONTOUR) {
      panelWidth = width
      panelHeight = height
      plate.clear()
      plate.fillStyle(PANEL_FILL, 0.98)
      plate.fillRoundedRect(-width / 2, -height / 2, width, height, PANEL_RADIUS * scale)
      plate.lineStyle(3 * scale, accent, 1)
      plate.strokeRoundedRect(-width / 2, -height / 2, width, height, PANEL_RADIUS * scale)
    },
    layout(width: number, height: number) {
      scrim.setPosition(width / 2, height / 2).setSize(width, height)
      panel.setPosition(width / 2, height / 2)
      void uiScale(width)
    },
    open() {
      scene.tweens.add({ targets: scrim, alpha: 1, duration: SCRIM_FADE_MS })
      panel.setScale(PANEL_FROM_SCALE)
      scene.tweens.add({ targets: panel, scale: 1, duration: PANEL_IN_MS, ease: 'Back.easeOut' })
    },
    close(done: () => void) {
      // Linear on the way out, and faster. An overshoot on close reads as the panel resisting —
      // the player has already decided, and the animation's only job is to not be jarring.
      scene.tweens.add({ targets: scrim, alpha: 0, duration: PANEL_OUT_MS })
      scene.tweens.add({ targets: panel, scale: PANEL_FROM_SCALE, alpha: 0, duration: PANEL_OUT_MS, onComplete: done })
    },
    destroy() {
      scrim.destroy()
      panel.destroy()
    },
  }
}
