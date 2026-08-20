import * as Phaser from 'phaser'
import { getTheme } from './theme'

/**
 * The match's side panel — the frame, and nothing that lives in it.
 *
 * Lifted from `../Checkers/src/ui/gamePanel.ts` (its own `PROMPT-GAME-SIDEPANEL.md` chunk 2), with
 * **one zone fewer**: that game's panel has a move list between the two player blocks and this one
 * has no moves to list. A Chapaev round is a sequence of flicks, not of notated moves, and a column
 * of "player 1 flicked" would be a list nobody reads taking the tallest zone on the screen.
 *
 * Zones are separated by **hairlines rather than by nested panels**: a panel inside a panel inside a
 * panel is visual noise, and the zones are already read as separate by what is in them.
 *
 * **Drawn, not composed from the widget kit**, because it is one shape: a rounded plum slab with a
 * two-tone gold edge — the light tone along the top where the light comes from, the dark one along
 * the bottom — and a soft inner shadow under the top edge so the surface reads as recessed rather
 * than as a sticker. Every other panel in this game is a `roundedPanel`, and this one cannot be:
 * `roundedPanel` centres on a point, and this is anchored to the board's own top and bottom.
 *
 * It draws into a `Graphics`, so `Game` hands {@link GamePanel.objects} to the UI camera the way it
 * does with everything else in the HUD.
 */
export interface GamePanel {
  readonly objects: Phaser.GameObjects.GameObject[]
  /** Paints the slab and the dividers. `dividers` are Y positions in screen space. */
  layout(x: number, y: number, width: number, height: number, scale: number, dividers: readonly number[]): void
  setVisible(visible: boolean): void
  destroy(): void
}

const RADIUS = 18
/** The edge is two strokes, not one: the light-from-above rule every other asset here follows,
 * applied to a big flat surface. */
const EDGE_WIDTH = 2
const EDGE_LIGHT = 0xffd977
const EDGE_DARK = 0x8a5a12
/** How far the inner shadow reaches down from the top edge. */
const INNER_SHADOW = 10
const DIVIDER_ALPHA = 0.15

export function createGamePanel(scene: Phaser.Scene): GamePanel {
  /**
   * Depth, not creation order.
   *
   * Everything this panel holds — the blocks, the buttons, the portrait — is created by the scene at
   * whatever point suits it, and a `Graphics` added later paints straight over the lot. That is
   * exactly what happened on the first run in the project this came from: a panel with no buttons
   * and no face on it, because both were underneath. Depth is scoped to the camera that renders the
   * object, so a negative one here orders the HUD without touching the board's own camera at all.
   */
  const graphics = scene.add.graphics().setDepth(-5)

  return {
    objects: [graphics],

    layout(x, y, width, height, scale, dividers) {
      const colors = getTheme().colors
      const radius = RADIUS * scale
      graphics.clear()
      graphics.setVisible(true)

      // The slab. One fill rather than two: the lower half was once darkened in a second step, which
      // drew a visible horizontal seam straight across the panel. The depth comes from the edge and
      // the inner shadow instead.
      graphics.fillStyle(colors.surface, 1)
      graphics.fillRoundedRect(x, y, width, height, radius)

      // The inner shadow under the top edge, as two fading bands. Cheap, and it survives the Canvas
      // fallback, which a real blur would not.
      graphics.fillStyle(colors.backgroundBottom, 0.28)
      graphics.fillRoundedRect(x, y, width, INNER_SHADOW * scale, { tl: radius, tr: radius, bl: 0, br: 0 })
      graphics.fillStyle(colors.backgroundBottom, 0.14)
      graphics.fillRect(x, y + INNER_SHADOW * scale, width, INNER_SHADOW * scale * 0.6)

      // The edge: dark all the way round so nothing is unfinished, then the light tone painted over
      // the top half only.
      graphics.lineStyle(EDGE_WIDTH * scale, EDGE_DARK, 0.9)
      graphics.strokeRoundedRect(x, y, width, height, radius)
      graphics.lineStyle(EDGE_WIDTH * scale, EDGE_LIGHT, 0.85)
      graphics.beginPath()
      graphics.moveTo(x + radius, y)
      graphics.lineTo(x + width - radius, y)
      graphics.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0)
      graphics.strokePath()

      graphics.lineStyle(1 * scale, EDGE_LIGHT, DIVIDER_ALPHA)
      for (const dividerY of dividers) {
        graphics.beginPath()
        graphics.moveTo(x + 12 * scale, dividerY)
        graphics.lineTo(x + width - 12 * scale, dividerY)
        graphics.strokePath()
      }
    },

    setVisible(visible) {
      graphics.setVisible(visible)
    },

    destroy() {
      graphics.destroy()
    },
  }
}
