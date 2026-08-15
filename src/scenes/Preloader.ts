import * as Phaser from 'phaser'
import { anchorCenter } from '../ui/anchors'
import { bindLayout } from '../ui/layout'

const MAX_BAR_WIDTH = 468
const BAR_HEIGHT = 32
// Keeps the bar off the edges on narrow viewports (e.g. 390px wide) instead of
// overflowing them at a fixed 468px.
const BAR_MARGIN = 40

export class Preloader extends Phaser.Scene {
  private track!: Phaser.GameObjects.Rectangle
  private bar!: Phaser.GameObjects.Rectangle
  private barWidth = MAX_BAR_WIDTH
  private progress = 0

  constructor() {
    super('Preloader')
  }

  init() {
    // Built in init(), not create(): preload()'s 'progress' events fire between init()
    // and create(), so the bar has to exist before that to have anything to update.
    this.track = this.add.rectangle(0, 0, MAX_BAR_WIDTH, BAR_HEIGHT).setStrokeStyle(1, 0xffffff)
    this.bar = this.add.rectangle(0, 0, 4, BAR_HEIGHT - 4, 0xffffff).setOrigin(0, 0.5)

    this.load.on('progress', (progress: number) => {
      this.progress = progress
      this.layoutBar()
    })

    bindLayout(this, (width, height) => this.layout(width, height))
  }

  preload() {
    this.load.setPath('assets')
    // Здесь подключаются все ассеты, нужные игре: спрайты, звуки, тайлмапы и т.д.
    this.load.audio('sfx', 'audio/blip.wav')
    this.load.audio('music', 'audio/blip.wav')
  }

  create() {
    this.scene.start('MainMenu')
  }

  layout(width: number, _height: number): void {
    this.barWidth = Math.min(MAX_BAR_WIDTH, width - BAR_MARGIN * 2)
    this.track.setSize(this.barWidth, BAR_HEIGHT)
    anchorCenter(this.track)
    this.layoutBar()
  }

  private layoutBar(): void {
    // Origin (0, 0.5): growing .width below extends rightward from this fixed left edge,
    // instead of symmetrically from a center point like the default origin would.
    anchorCenter(this.bar, -this.barWidth / 2 + 4, 0)
    this.bar.width = 4 + (this.barWidth - 8) * this.progress
  }
}
