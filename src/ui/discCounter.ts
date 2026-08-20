import * as Phaser from 'phaser'
import { pieceSet, type PieceSetId } from '../game/skins'
import type { Side } from '../sim/types'

/**
 * How many discs each side still has, as two rows of pips.
 *
 * ## It is the HUD, not an ornament on it
 *
 * A round of Chapaev has no score, no clock and no progress bar. Who is winning is **entirely** a
 * question of how many discs each side has left, and before this the answer was only available by
 * counting the board — which is exactly the thing a player is already busy doing for aim. A number
 * would answer it too, but a row of pips answers it without reading: five against three is a shape.
 *
 * ## A lost pip is an EVENT
 *
 * The pip does not disappear when the count changes; it fades and shrinks where it stood. A count
 * that silently drops by one is a fact the player finds later, and the moment a disc leaves the
 * board is the most important moment in the game. The animation is deliberately slower than the
 * disc's own fall, so it is still going when the eye comes back from the rim.
 */

const PIP_RADIUS = 7
const PIP_GAP = 6
const ROW_GAP = 12
const LOST_FADE_MS = 420
const LOST_SCALE = 1.9

/** Empty sockets stay behind at low alpha, so the row's WIDTH never changes and the two sides can
 * be compared by length rather than by counting. A row that shrank as it lost discs would make the
 * comparison harder exactly as it became urgent. */
const SOCKET_ALPHA = 0.22

export interface DiscCounter {
  readonly objects: Phaser.GameObjects.GameObject[]
  /** Total drawn size, for a caller placing it inside a band. */
  readonly width: number
  readonly height: number
  /**
   * Sets both counts. A count that DROPPED animates the pips it lost; anything else snaps, so
   * starting a round or restoring a save does not fire an animation for discs nobody lost.
   */
  setCounts(player: number, opponent: number, animate?: boolean): void
  layout(centreX: number, centreY: number, scale: number): void
  destroy(): void
}

interface Row {
  side: Side
  pips: Phaser.GameObjects.Arc[]
  count: number
}

export function createDiscCounter(scene: Phaser.Scene, capacity: number, pieces: PieceSetId): DiscCounter {
  const set = pieceSet(pieces)
  const objects: Phaser.GameObjects.GameObject[] = []
  let scale = 1
  let centre = { x: 0, y: 0 }

  const make = (side: Side): Row => {
    const colour = side === 'player' ? set.player.mid : set.opponent.mid
    const pips = Array.from({ length: capacity }, () => {
      const pip = scene.add.circle(0, 0, PIP_RADIUS, colour).setStrokeStyle(2, 0x241033, 1)
      objects.push(pip)
      return pip
    })
    return { side, pips, count: capacity }
  }

  const rows: Row[] = [make('opponent'), make('player')]

  function redraw(): void {
    const r = PIP_RADIUS * scale
    const step = r * 2 + PIP_GAP * scale
    const rowWidth = capacity * step - PIP_GAP * scale
    const rowStep = r * 2 + ROW_GAP * scale

    rows.forEach((row, index) => {
      const y = centre.y + (index - (rows.length - 1) / 2) * rowStep
      row.pips.forEach((pip, i) => {
        pip.setRadius(r)
        pip.setPosition(centre.x - rowWidth / 2 + r + i * step, y)
        // Only set alpha for pips that are not mid-animation: the tween owns those.
        if (!scene.tweens.isTweening(pip)) pip.setAlpha(i < row.count ? 1 : SOCKET_ALPHA)
      })
    })
  }

  return {
    objects,
    get width() {
      return capacity * (PIP_RADIUS * 2 * scale + PIP_GAP * scale) - PIP_GAP * scale
    },
    get height() {
      return rows.length * (PIP_RADIUS * 2 * scale) + (rows.length - 1) * ROW_GAP * scale
    },
    setCounts(player: number, opponent: number, animate = true) {
      const next: Record<Side, number> = { player, opponent }
      for (const row of rows) {
        const target = Math.max(0, Math.min(capacity, next[row.side]))
        if (animate && target < row.count) {
          // Every pip between the new count and the old one is one that just left the board.
          for (let i = target; i < row.count; i++) {
            const pip = row.pips[i]
            scene.tweens.killTweensOf(pip)
            pip.setAlpha(1).setScale(1)
            scene.tweens.add({
              targets: pip,
              alpha: SOCKET_ALPHA,
              scale: LOST_SCALE,
              duration: LOST_FADE_MS,
              ease: 'Cubic.easeOut',
              // Reset the scale at the end rather than tweening back: the pip is now a socket, and
              // a socket that pulsed back to size would read as the disc returning.
              onComplete: () => pip.setScale(1),
            })
          }
        }
        row.count = target
      }
      redraw()
    },
    layout(centreX: number, centreY: number, nextScale: number) {
      scale = nextScale
      centre = { x: centreX, y: centreY }
      redraw()
    },
    destroy() {
      for (const object of objects) object.destroy()
    },
  }
}
