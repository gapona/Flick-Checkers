import * as Phaser from 'phaser'

/**
 * **A comic speech bubble: a plate fitted around a `Text`, with a tail that points at whoever said
 * it.**
 *
 * One component rather than a copy per screen. It is drawn in two places — the opponent picker, where
 * it points at a card's portrait, and the menu, where it points at the mascot's head — and two
 * copies of "fit a rounded plate around a growing line and hang a triangle off it" is two places for
 * the corner radius, the tail geometry and the ink colour to drift apart.
 *
 * ## The split: this owns the LOOK, the caller owns the PLACEMENT
 *
 * Where a bubble goes is a question about the screen it is on — beside a scrolling card, above a
 * character standing in a corner — and no shared component can answer it. So the caller works out
 * the plate's top-left corner and which side of it the tail hangs from, and this fits the plate to
 * the text, draws it, and puts the tail where it was told. {@link SpeechBubble.size} exists for the
 * caller's half of that: the plate's size is derived from the text, so a caller deciding whether it
 * fits above something has to be able to ask before committing.
 *
 * ## Light plate, dark ink
 *
 * The inverse of every other surface in this game, deliberately. A speech bubble is a different KIND
 * of object from a card or a panel, and inverting it is how a comic says so without a label — it is
 * also the only light surface on either screen that uses it, so the eye finds it immediately.
 *
 * ## It is redrawn as the line types
 *
 * The plate is fitted to the text and `ui/speechLine.ts` reveals the text one character at a time, so
 * a caller pumps {@link SpeechBubble.draw} from its `onGlyph`. A plate sized once for the finished
 * line is a bubble that appears at full size around a single letter.
 */

const FILL = 0xf2e8ff
const STROKE = 0xffc23c
const INK = '#2a0f40'
const PADDING = 9
const RADIUS = 10

export interface BubbleSize {
  width: number
  height: number
}

/** Which edge of the plate the tail hangs off. */
export type BubbleEdge = 'top' | 'bottom' | 'left' | 'right'

/** The point the tail aims at — the speaker's face. */
export interface BubbleTip {
  x: number
  y: number
}

/**
 * Half the tail's base, and its length — one number, because a tail much longer than it is wide reads
 * as a spike and one much wider reads as a dent.
 *
 * Exported because a caller deciding WHERE a bubble goes has to leave room for it, and the first
 * version of that arithmetic left it out: the menu's bubble was measured as the plate alone, cleared
 * the button column by four pixels on one phone and overlapped it by three on another.
 */
export const BUBBLE_TAIL = 7
const TAIL = BUBBLE_TAIL

export interface SpeechBubble {
  /** The `Text` the caller hands to `speechLine()`. Its content and visibility are driven from
   * there; this component only ever positions it. */
  readonly text: Phaser.GameObjects.Text
  /** Everything it draws, for a scene assigning camera membership. */
  readonly objects: Phaser.GameObjects.GameObject[]
  /** Sets the type size and the wrap width. Call from `layout()`, before {@link draw}. */
  setMetrics(fontSize: number, wrapWidth: number): void
  /** The plate the CURRENT text would need. A caller decides where a bubble goes from this. */
  size(scale: number): BubbleSize
  /**
   * Draws the plate at `left, top` with the tail hanging off one edge, aimed at `tip`.
   *
   * `edge` is where the TAIL is, not where the bubble is: `'bottom'` means the tail hangs off the
   * plate's bottom, i.e. the bubble sits above whatever it points at. All four exist because a
   * bubble has to go wherever there is room — the menu's mascot cannot always speak upward, since on
   * a short screen the band between its hat and the button column is smaller than the bubble.
   */
  draw(left: number, top: number, tip: BubbleTip, edge: BubbleEdge, scale: number): void
  hide(): void
  destroy(): void
}

export function createSpeechBubble(scene: Phaser.Scene, depth = 0): SpeechBubble {
  const plate = scene.add.graphics().setDepth(depth).setVisible(false)
  const text = scene.add
    .text(0, 0, '', { fontFamily: 'Arial', fontSize: 13, color: INK, align: 'left' })
    .setOrigin(0, 0)
    .setDepth(depth + 1)
    .setVisible(false)

  return {
    text,
    objects: [plate, text],

    setMetrics(fontSize: number, wrapWidth: number) {
      text.setFontSize(fontSize).setWordWrapWidth(wrapWidth)
    },

    size(scale: number): BubbleSize {
      return { width: text.width + PADDING * 2 * scale, height: text.height + PADDING * 2 * scale }
    },

    draw(left: number, top: number, tip: BubbleTip, edge: BubbleEdge, scale: number) {
      const pad = PADDING * scale
      const tail = TAIL * scale
      const width = text.width + pad * 2
      const height = text.height + pad * 2

      plate.clear().setVisible(true)
      plate.fillStyle(FILL, 1)
      plate.fillRoundedRect(left, top, width, height, RADIUS * scale)
      plate.lineStyle(2 * scale, STROKE, 1)
      plate.strokeRoundedRect(left, top, width, height, RADIUS * scale)

      // The tail's base runs ALONG the chosen edge and its point reaches out from it. Clamped into
      // the plate's own span, so a speaker off to one side still gets a tail attached to the bubble
      // rather than one floating past its corner.
      const vertical = edge === 'top' || edge === 'bottom'
      const aim = vertical
        ? Phaser.Math.Clamp(tip.x, left + tail * 1.5, left + width - tail * 1.5)
        : Phaser.Math.Clamp(tip.y, top + tail * 1.5, top + height - tail * 1.5)

      let a: BubbleTip
      let b: BubbleTip
      let point: BubbleTip
      if (edge === 'bottom') {
        a = { x: aim - tail, y: top + height }
        b = { x: aim + tail, y: top + height }
        point = { x: aim, y: top + height + tail }
      } else if (edge === 'top') {
        a = { x: aim - tail, y: top }
        b = { x: aim + tail, y: top }
        point = { x: aim, y: top - tail }
      } else if (edge === 'left') {
        a = { x: left, y: aim - tail }
        b = { x: left, y: aim + tail }
        point = { x: left - tail, y: aim }
      } else {
        a = { x: left + width, y: aim - tail }
        b = { x: left + width, y: aim + tail }
        point = { x: left + width + tail, y: aim }
      }

      plate.fillStyle(FILL, 1)
      plate.fillTriangle(a.x, a.y, b.x, b.y, point.x, point.y)
      // The outline is two lines rather than a stroked triangle: a triangle would draw its own base
      // across the plate it is part of, which reads as a seam.
      plate.lineStyle(2 * scale, STROKE, 1)
      plate.lineBetween(a.x, a.y, point.x, point.y)
      plate.lineBetween(b.x, b.y, point.x, point.y)

      text.setPosition(left + pad, top + pad).setVisible(true)
    },

    hide() {
      plate.clear().setVisible(false)
      text.setVisible(false)
    },

    destroy() {
      plate.destroy()
      text.destroy()
    },
  }
}
