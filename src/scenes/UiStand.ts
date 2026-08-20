import * as Phaser from 'phaser'
import { ATLAS_FRAMES } from '../assets'
import { gameButton, type ButtonSize, type ButtonVariant, type GameButton } from '../ui/button'
import { createPageBackground, type PageBackground } from '../ui/chrome'
import { bindLayout } from '../ui/layout'
import { uiScale, MIN_TOUCH_TARGET } from '../ui/uiScale'

/**
 * The widget stand: every size token x every variant x every state, on one screen.
 *
 * **DEV ONLY.** Registered behind `import.meta.env.DEV` in `config.ts` and reached with
 * `window.__ui()`; nothing in the game navigates here, and it is dead-code-eliminated from a
 * production build (verified by the bundle size, which is what `npm run bundle` reports).
 *
 * It exists because the acceptance criterion for the button factory is a comparison, not a
 * behaviour: "every button of one token is pixel-identical" cannot be checked by looking at the
 * menu, where each token appears once. A stand puts the four that should match side by side, and a
 * disagreement is then impossible to miss rather than merely possible to find.
 *
 * The dashed rectangle behind each button is its TAP TARGET, drawn at its true size. That is the
 * other thing a stand is for: `MIN_TOUCH_TARGET` is a promise made in prose everywhere else in the
 * codebase, and here it is a rectangle you can see is bigger than the `icon` token it surrounds.
 */
const SIZES: ButtonSize[] = ['primary', 'secondary', 'compact', 'icon']
const VARIANTS: ButtonVariant[] = ['gold', 'plum', 'ghost']

interface Cell {
  button: GameButton
  column: number
  row: number
}

export class UiStand extends Phaser.Scene {
  private cells: Cell[] = []
  private captions: Phaser.GameObjects.Text[] = []
  private targets!: Phaser.GameObjects.Graphics
  private pageBackground!: PageBackground

  constructor() {
    super('UiStand')
  }

  create() {
    // Instance state is set up in create(), not at the field declaration — a restarted scene
    // re-runs create() but not the initialisers (CLAUDE.md's invariant list).
    this.cells = []
    this.captions = []

    this.pageBackground = createPageBackground(this)
    this.targets = this.add.graphics()

    SIZES.forEach((size, row) => {
      VARIANTS.forEach((variant, column) => {
        const button = gameButton(this, { size, variant, label: size === 'icon' ? undefined : 'Continue', iconFrame: size === 'icon' ? ATLAS_FRAMES.gear : undefined })
        this.cells.push({ button, column, row })
      })

      // A fourth column repeating the `plum` variant disabled, and a fifth with a deliberately
      // over-long label — the two states that only go wrong once, in a locale nobody tested.
      const disabled = gameButton(this, { size, variant: 'plum', label: size === 'icon' ? undefined : 'Continue', iconFrame: size === 'icon' ? ATLAS_FRAMES.gear : undefined })
      disabled.setEnabled(false)
      this.cells.push({ button: disabled, column: 3, row })

      const long = gameButton(this, { size, variant: 'plum', label: size === 'icon' ? undefined : 'Continuar partida', iconFrame: size === 'icon' ? ATLAS_FRAMES.gear : undefined })
      this.cells.push({ button: long, column: 4, row })
    })

    for (const caption of ['gold', 'plum', 'ghost', 'plum · disabled', 'plum · long label']) {
      this.captions.push(this.add.text(0, 0, caption, { fontFamily: 'monospace', fontSize: 12, color: '#a892c4' }).setOrigin(0.5, 1))
    }
    for (const size of SIZES) {
      this.captions.push(this.add.text(0, 0, size, { fontFamily: 'monospace', fontSize: 12, color: '#f5b52e' }).setOrigin(1, 0.5))
    }

    bindLayout(this, (width, height) => this.layout(width, height))
  }

  layout(width: number, height: number): void {
    this.pageBackground.resize(width, height)
    const scale = uiScale(width)
    const columns = VARIANTS.length + 2

    /**
     * The matrix needs a wide viewport, and that is a property of the thing being tested rather
     * than a shortcoming of the stand: the `primary` token is 280 design units, and five of them
     * plus gutters cannot be shown across a 390px phone at any scale that would still be a fair
     * comparison. So a narrow viewport gets ONE column, with the state cycling down the rows —
     * every size and every state is still present and checkable, just not side by side.
     *
     * The side-by-side comparison is the wide layout's job precisely because that is the layout
     * where it is possible.
     */
    const narrow = width < 640

    if (narrow) {
      // One column, one variant. Twenty buttons down 844px is 42px a row — less than a button —
      // so showing the whole matrix here would prove nothing except that things overlap. What the
      // narrow viewport is actually being asked is whether a 280-unit token still fits and stays
      // legible at `uiScale(390)`, and four buttons answer that.
      const shown = this.cells.filter((cell) => cell.column === 0)
      for (const cell of this.cells) cell.button.container.setVisible(cell.column === 0)
      const rowHeight = (height - 80) / shown.length
      shown.forEach((cell, i) => cell.button.layout(width / 2, 64 + rowHeight * (i + 0.5), scale))
      for (const caption of this.captions) caption.setVisible(false)
      this.drawTargets(width, height, narrow, shown)
      return
    }

    for (const cell of this.cells) cell.button.container.setVisible(true)

    for (const caption of this.captions) caption.setVisible(true)
    const left = 96
    const usable = Math.max(width - left - 24, 320)
    const columnWidth = usable / columns
    const rowHeight = Math.max((height - 90) / SIZES.length, 90)

    for (const { button, column, row } of this.cells) {
      button.layout(left + columnWidth * (column + 0.5), 74 + rowHeight * (row + 0.5), scale)
    }

    // Column captions along the top, row captions down the left.
    this.captions.slice(0, columns).forEach((caption, i) => caption.setPosition(left + columnWidth * (i + 0.5), 56))
    this.captions.slice(columns).forEach((caption, i) => caption.setPosition(left - 16, 74 + rowHeight * (i + 0.5)))
    this.drawTargets(width, height, narrow)
  }

  /** The dashed outlines are the point of the stand as much as the buttons are: `MIN_TOUCH_TARGET`
   * is prose everywhere else in the codebase, and here it is a rectangle you can see is bigger than
   * the `icon` token it surrounds. */
  private drawTargets(width: number, height: number, narrow: boolean, only?: Cell[]): void {

    this.targets.clear()
    this.targets.lineStyle(1, 0x4ad9a4, 0.55)
    for (const { button } of only ?? this.cells) {
      const { hitArea } = button
      this.targets.strokeRect(
        button.container.x - hitArea.width / 2,
        button.container.y - hitArea.height / 2,
        hitArea.width,
        hitArea.height,
      )
    }

    // The 44px floor itself, as a reference square in the corner.
    this.targets.lineStyle(1, 0xff6a3d, 0.8)
    const x = narrow ? 12 : 20
    this.targets.strokeRect(x, height - MIN_TOUCH_TARGET - 12, MIN_TOUCH_TARGET, MIN_TOUCH_TARGET)
  }
}
