import * as Phaser from 'phaser'
import { bindAction } from '../platform/input'
import { anchorTopRight } from '../ui/anchors'
import { bindLayout } from '../ui/layout'
import { ensureMinHitArea, uiScale } from '../ui/uiScale'

const GEAR_FONT_SIZE = 32

// Fixed logical resolution the gameplay world is authored against — game objects use
// these coordinates regardless of the real viewport. See CLAUDE.md "Responsive Layout"
// for the full contract; layout() below is the letterbox/zoom half of it.
const LOGICAL_WIDTH = 960
const LOGICAL_HEIGHT = 540

export class Game extends Phaser.Scene {
  private gearButton!: Phaser.GameObjects.Text
  private uiCamera!: Phaser.Cameras.Scene2D.Camera

  constructor() {
    super('Game')
  }

  create() {
    this.gearButton = this.add
      .text(0, 0, '⚙', { fontFamily: 'Arial', fontSize: GEAR_FONT_SIZE, color: '#ffffff' })
      .setOrigin(1, 0)

    // Split world/UI cameras: cameras.main gets zoomed/panned onto the fixed logical world
    // in layout() below, which would otherwise also zoom/pan any screen-space UI drawn
    // through it (confirmed as an actual rendering bug in testing, not just a theoretical
    // one — the gear button rendered near mid-screen instead of the corner). uiCamera stays
    // 1:1 with the real viewport always. Each camera excludes the other's content — new UI
    // must be added to uiCamera's default render set and `cameras.main.ignore(...)`-ed like
    // gearButton here; new world content is the reverse. See CLAUDE.md "Responsive Layout".
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    this.cameras.main.ignore(this.gearButton)

    bindAction(this, 'openSettings', { pointer: this.gearButton, keys: ['ESC'] }, () => {
      this.scene.pause()
      this.scene.launch('Settings', { opener: 'Game' })
    })

    bindLayout(this, (width, height) => this.layout(width, height))

    // Здесь начинается основная игровая логика.
  }

  layout(width: number, height: number): void {
    // World camera: fit the fixed logical resolution into the real viewport by the
    // smaller of the two axis ratios, so the full logical area is always visible
    // without cropping (letterboxed on the other axis).
    const zoom = Math.min(width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT)
    this.cameras.main.setZoom(zoom)
    this.cameras.main.centerOn(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2)

    // UI camera: always identity-mapped to the current viewport, independent of the
    // world camera's zoom/pan above.
    this.uiCamera.setViewport(0, 0, width, height)

    const scale = uiScale(width)
    this.gearButton.setFontSize(GEAR_FONT_SIZE * scale)
    anchorTopRight(this.gearButton, 20, 20)
    ensureMinHitArea(this.gearButton)
  }

  update() {
    // Игровой цикл.
  }
}
