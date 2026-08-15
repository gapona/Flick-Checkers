import * as Phaser from 'phaser'
import { isMusicOn, isSoundOn, setMusic, setSound } from '../audio/audio'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { t } from '../i18n/strings'
import { anchorCenter } from '../ui/anchors'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { getTheme, neonButton, roundedPanel, toCssColor, type NeonButton, type RoundedPanel } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

interface SettingsData {
  opener: string
}

const PANEL_WIDTH = 360
const PANEL_HEIGHT = 220
const TITLE_FONT_SIZE = 28
const TOGGLE_FONT_SIZE = 22
const CLOSE_FONT_SIZE = 24

interface Toggle {
  button: NeonButton
  flip: () => void
}

export class Settings extends Phaser.Scene {
  private openerKey = ''
  private backdrop!: Phaser.GameObjects.Rectangle
  private panel!: RoundedPanel
  private title!: Phaser.GameObjects.Text
  private soundToggle!: Toggle
  private musicToggle!: Toggle
  private closeButton!: NeonButton

  constructor() {
    super('Settings')
  }

  create(data: SettingsData) {
    this.openerKey = data.opener

    // Semi-transparent backdrop: dims the paused scene beneath and swallows clicks that would
    // otherwise fall through to it. Sized 0x0 here on purpose — layout() is the only place
    // that sets real dimensions, on create and on every resize. NOT calling .setInteractive()
    // here: Phaser's setInteractive() derives its hit area from the object's current
    // width/height, and silently creates no `.input` at all when that's 0x0 — layout() below
    // makes it interactive for the first time once a real size exists.
    this.backdrop = this.add.rectangle(0, 0, 0, 0, 0x000000, 0.6)

    this.panel = roundedPanel(this)

    this.title = this.add
      .text(0, 0, t('settings'), { fontFamily: getDisplayFontStack(), fontSize: TITLE_FONT_SIZE, color: toCssColor(getTheme().colors.primary) })
      .setOrigin(0.5)

    this.soundToggle = this.createToggle(t('sound'), isSoundOn(), setSound)
    bindAction(this, 'toggleSound', { pointer: this.soundToggle.button.container, keys: ['S'] }, this.soundToggle.flip)

    this.musicToggle = this.createToggle(t('music'), isMusicOn(), setMusic)
    bindAction(this, 'toggleMusic', { pointer: this.musicToggle.button.container, keys: ['M'] }, this.musicToggle.flip)

    this.closeButton = neonButton(this, t('close'), getTheme().colors.primary, CLOSE_FONT_SIZE)
    bindAction(this, 'close', { pointer: this.closeButton.container, keys: ['ESC', 'ENTER'] }, () => this.close())

    bindLayout(this, (width, height) => this.layout(width, height))
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)

    // Full-bleed backdrop tracks the viewport exactly. setSize() alone only changes what gets
    // drawn, not the input hit area — setInteractive() derives the hit area from the object's
    // size at the moment it's *first* called and re-calling it after that does NOT recompute
    // it, so every subsequent resize has to mutate the existing hitArea Rectangle directly.
    this.backdrop.setPosition(width / 2, height / 2).setSize(width, height)
    if (!this.backdrop.input) {
      this.backdrop.setInteractive()
    } else {
      ;(this.backdrop.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height)
    }

    this.panel.draw(width / 2, height / 2, PANEL_WIDTH * scale, PANEL_HEIGHT * scale, getTheme().colors.secondary)

    this.title.setFontSize(TITLE_FONT_SIZE * scale)
    anchorCenter(this.title, 0, -80 * scale)

    this.soundToggle.button.setFontSize(TOGGLE_FONT_SIZE * scale)
    anchorCenter(this.soundToggle.button.container, 0, -20 * scale)

    this.musicToggle.button.setFontSize(TOGGLE_FONT_SIZE * scale)
    anchorCenter(this.musicToggle.button.container, 0, 30 * scale)

    this.closeButton.setFontSize(CLOSE_FONT_SIZE * scale)
    anchorCenter(this.closeButton.container, 0, 90 * scale)
  }

  private createToggle(label: string, initial: boolean, onChange: (on: boolean) => void): Toggle {
    let value = initial
    const button = neonButton(this, `${label}: ${value ? t('on') : t('off')}`, getTheme().colors.secondary, TOGGLE_FONT_SIZE)
    const flip = () => {
      value = !value
      button.setText(`${label}: ${value ? t('on') : t('off')}`)
      onChange(value)
    }
    return { button, flip }
  }

  private close(): void {
    this.scene.stop()

    if (isPlatformPaused()) {
      // A platform pause (e.g. the YouTube tab backgrounded) started while Settings was open.
      // Resuming the opener now would unpause gameplay/audio the platform still considers
      // suspended; defer until the matching YTEvents.RESUME actually fires.
      this.game.events.once(YTEvents.RESUME, () => {
        this.scene.resume(this.openerKey)
      })
      return
    }

    this.scene.resume(this.openerKey)
  }
}
