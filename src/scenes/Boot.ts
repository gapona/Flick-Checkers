import * as Phaser from 'phaser'
import { firstFrameReady } from '../platform/yt'

export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload() {
    // Минимум ассетов, нужных для отрисовки экрана загрузки (Preloader),
    // подключается здесь, до старта основного Preloader.
  }

  create() {
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      firstFrameReady()
    })

    this.scene.start('Preloader')
  }
}
