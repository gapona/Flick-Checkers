import * as Phaser from 'phaser'
import { getDisplayFontStack } from './font'
import { getTheme, playPressSound } from './theme'
import { MIN_TOUCH_TARGET } from './uiScale'

/**
 * A two- or three-way switch: one bar, one lit segment.
 *
 * Lifted from `../Checkers/src/ui/segmented.ts`. `Shop` is what wanted it: the catalogue is two
 * independent wardrobes — six boards and four disc sets, worn in separate slots — and it was one
 * flat list of ten rows, 810px of it, which fits no phone this game targets. Splitting it in two
 * halves the scrolling and, more to the point, stops the screen implying the two are one choice.
 */
export interface Segmented {
  readonly objects: Phaser.GameObjects.GameObject[]
  readonly height: number
  readonly index: number
  setIndex(index: number): void
  /**
   * Shows or hides the whole control, INPUT included.
   *
   * The pair go together on purpose: a hidden game object still answers pointer events in Phaser, so
   * a control merely made invisible keeps a live 44px band wherever it was last laid out — which, on
   * a screen that reflows when it disappears, is under whatever moved up to take its place.
   */
  setVisible(visible: boolean): void
  layout(x: number, y: number, width: number, scale: number): void
  destroy(): void
}

export interface SegmentedOptions {
  labels: string[]
  initial: number
  onSelect(index: number): void
}

const FONT_SIZE = 16
const RADIUS = 12
/** Inset of a selected segment's fill from the bar's own edge, so the selection reads as a pill
 * INSIDE the control rather than as a second control on top of it. */
const INSET = 3

export function createSegmented(scene: Phaser.Scene, options: SegmentedOptions): Segmented {
  const colors = getTheme().colors

  const graphics = scene.add.graphics()
  const labels = options.labels.map((text) =>
    scene.add.text(0, 0, text, { fontFamily: getDisplayFontStack(), fontSize: FONT_SIZE, color: '#ffffff' }).setOrigin(0.5),
  )
  // One hit rectangle per segment, never a Container: `Container`'s origin offset breaks its own hit
  // test (CLAUDE.md "UI Kit"), and a segment is a rectangle anyway.
  const hits = options.labels.map(() => scene.add.rectangle(0, 0, 1, 1, 0x000000, 0).setOrigin(0, 0.5))

  let index = options.initial
  let scale = 1
  let bounds = { x: 0, y: 0, width: 1, height: MIN_TOUCH_TARGET }

  const redraw = (): void => {
    const { x, y, width, height } = bounds
    const segment = width / labels.length

    graphics.clear()
    graphics.fillStyle(colors.backgroundBottom, 0.85)
    graphics.fillRoundedRect(x, y - height / 2, width, height, RADIUS * scale)
    graphics.lineStyle(2, colors.secondary, 0.6)
    graphics.strokeRoundedRect(x, y - height / 2, width, height, RADIUS * scale)

    const inset = INSET * scale
    graphics.fillStyle(colors.accent, 1)
    graphics.fillRoundedRect(x + segment * index + inset, y - height / 2 + inset, segment - inset * 2, height - inset * 2, (RADIUS - INSET) * scale)

    labels.forEach((label, i) => {
      label.setFontSize(FONT_SIZE * scale)
      // Every label stays light, selected or not: the selection is carried by the FILL, which is what
      // a segmented control's selection is supposed to be carried by. The project this came from
      // tried a dark glyph on the gold pill and got a smudge.
      label.setColor(i === index ? '#241033' : '#e6d8ff')
      label.setPosition(x + segment * (i + 0.5), y)
    })
  }

  hits.forEach((hit, i) => {
    hit.setInteractive({ useHandCursor: true })
    hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      if (i === index) return
      // After the no-op check: tapping the segment already selected should not click, or the control
      // sounds like it did something when it did not.
      playPressSound()
      index = i
      redraw()
      options.onSelect(i)
    })
  })

  redraw()

  return {
    get objects() {
      return [graphics, ...hits, ...labels]
    },
    get height() {
      return bounds.height
    },
    get index() {
      return index
    },
    setIndex(next: number) {
      if (next === index) return
      index = next
      redraw()
    },
    setVisible(visible: boolean) {
      graphics.setVisible(visible)
      for (const label of labels) label.setVisible(visible)
      for (const hit of hits) {
        hit.setVisible(visible)
        if (hit.input) hit.input.enabled = visible
      }
    },
    layout(x: number, y: number, width: number, nextScale: number) {
      scale = nextScale
      const height = MIN_TOUCH_TARGET * scale
      bounds = { x, y: y + height / 2, width, height }
      const segment = width / labels.length
      hits.forEach((hit, i) => {
        hit.setSize(segment, height).setPosition(x + segment * i, bounds.y)
        if (!hit.input) hit.setInteractive({ useHandCursor: true })
        const area = hit.input?.hitArea as Phaser.Geom.Rectangle | undefined
        area?.setTo(0, 0, segment, height)
      })
      redraw()
    },
    destroy() {
      graphics.destroy()
      for (const label of labels) label.destroy()
      for (const hit of hits) hit.destroy()
    },
  }
}
