import * as Phaser from 'phaser'
import { countUp } from './countUp'
import { getDisplayFontStack } from './font'

/**
 * Labelled numbers, as two columns rather than as centred lines.
 *
 * ## Why not one centred line per row
 *
 * `PROMPT-UI-CHAPAEV.md`'s chunk 10 names the defect precisely: a centred `Score 9365` moves
 * sideways the moment the number gains a digit, and on a panel of four such rows every row moves by
 * a different amount. The eye then has no vertical line to follow and has to re-find the numbers on
 * every panel it sees — five times a match.
 *
 * Here the two columns are FIXED width and meet at the middle: labels are right-aligned against that
 * seam, values left-aligned from it. A value going from `9` to `9365` grows rightward into its own
 * column and nothing else on the panel moves.
 *
 * Values are `tabular`-spaced by construction rather than by font feature — every digit in the
 * display face is already the same width, which is what makes a column of them line up at all.
 */

const LABEL_FONT_SIZE = 15
const VALUE_FONT_SIZE = 17
const ROW_HEIGHT = 26
/** The gap at the seam, split evenly either side of it. */
const COLUMN_GAP = 16

const LABEL_COLOR = '#a892c4'
const VALUE_COLOR = '#f2e8ff'

export interface StatRow {
  label: string
  value: number
  /** Prefixes the value once it has finished counting — the coins row is `+120`, not `120`. */
  prefix?: string
  /** A row that should not count up: a ratio, a name, anything that is not a magnitude. */
  literal?: string
}

export interface StatGrid {
  readonly objects: Phaser.GameObjects.GameObject[]
  /** Total drawn height, for a panel sizing itself from its content. */
  height(scale: number): number
  layout(centreX: number, topY: number, width: number, scale: number): void
  /** Starts every row's number at zero and counts them all up together. `onComplete` fires once, at
   * the end of the longest one. */
  animate(onComplete?: () => void): void
  destroy(): void
}

export function createStatGrid(scene: Phaser.Scene, rows: readonly StatRow[]): StatGrid {
  const objects: Phaser.GameObjects.GameObject[] = []

  const built = rows.map((row) => {
    const label = scene.add
      .text(0, 0, row.label, { fontFamily: getDisplayFontStack(), fontSize: LABEL_FONT_SIZE, color: LABEL_COLOR })
      .setOrigin(1, 0.5)
    const value = scene.add
      .text(0, 0, row.literal ?? `${row.prefix ?? ''}${row.value}`, {
        fontFamily: getDisplayFontStack(),
        fontSize: VALUE_FONT_SIZE,
        color: VALUE_COLOR,
      })
      .setOrigin(0, 0.5)
    objects.push(label, value)
    return { row, label, value }
  })

  return {
    objects,
    height(scale: number) {
      return rows.length * ROW_HEIGHT * scale
    },
    layout(centreX: number, topY: number, width: number, scale: number) {
      const seam = centreX + width * 0.04
      built.forEach(({ label, value }, index) => {
        const y = topY + (index + 0.5) * ROW_HEIGHT * scale
        label.setFontSize(LABEL_FONT_SIZE * scale).setPosition(seam - (COLUMN_GAP / 2) * scale, y)
        value.setFontSize(VALUE_FONT_SIZE * scale).setPosition(seam + (COLUMN_GAP / 2) * scale, y)
      })
    },
    animate(onComplete?: () => void) {
      let pending = 0
      let finished = false
      const done = (): void => {
        pending--
        if (pending === 0 && !finished) {
          finished = true
          onComplete?.()
        }
      }

      for (const { row } of built) {
        if (row.literal !== undefined) continue
        pending++
      }
      if (pending === 0) {
        onComplete?.()
        return
      }

      for (const { row, value } of built) {
        if (row.literal !== undefined) continue
        countUp(scene, value, row.value, { format: (n) => `${row.prefix ?? ''}${n}`, onComplete: done })
      }
    },
    destroy() {
      for (const object of objects) object.destroy()
    },
  }
}
