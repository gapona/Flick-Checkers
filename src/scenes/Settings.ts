import * as Phaser from 'phaser'
import { SFX } from '../assets'
import { musicRestoreLevel, musicVolume, playSfx, setMusicVolume, setSfxVolume, sfxRestoreLevel, sfxVolume } from '../audio/audio'
import { t } from '../i18n/strings'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { gameButton, type GameButton } from '../ui/button'
import { createOverlay, type Overlay } from '../ui/overlay'
import { createSlider, type Slider } from '../ui/slider'
import { getTheme, toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

interface SettingsData {
  opener: string
}

const PANEL_WIDTH = 340
/**
 * 330 and not the 300 it shipped at, because 300 never fitted its own contents.
 *
 * Add them up at scale 1: the title sits 34 from the top, each slider row is as tall as its 64-unit
 * mute button, and the Close button is 56 tall sitting 46 up from the bottom. Laid out inside 300
 * the second row's mute button ended 2 units INSIDE the Close button's top edge. The rows below are
 * placed so nothing touches; check the arithmetic in {@link Settings.layout} before moving any of
 * them.
 */
const PANEL_HEIGHT = 330
/** Padding between the panel's border and the slider rows, per side. */
const PANEL_PADDING = 20
const TITLE_FONT_SIZE = 26

/**
 * Settings, as two faders.
 *
 * The pause/resume dance is unchanged and is the delicate part: opening pauses the OPENER by key,
 * closing resumes exactly that scene, and if a platform pause arrived while this was open the
 * resume is deferred to the next `YTEvents.RESUME` rather than fired now — otherwise closing
 * settings would resume gameplay the platform still considers suspended. See CLAUDE.md "Audio
 * Layer".
 *
 * What changed is everything above it: the two ON/OFF rows are two volume sliders, on the scrim
 * from `ui/overlay.ts` rather than on a bare panel with the game still legible behind it.
 */
export class Settings extends Phaser.Scene {
  private openerKey = ''
  private overlay!: Overlay
  private title!: Phaser.GameObjects.Text
  private sfx!: Slider
  private music!: Slider
  private closeButton!: GameButton

  constructor() {
    super('Settings')
  }

  create(data: SettingsData) {
    this.openerKey = data.opener

    this.overlay = createOverlay(this, { onDismiss: () => this.close() })

    this.title = this.add
      .text(0, 0, t('settings'), { fontFamily: getDisplayFontStack(), fontSize: TITLE_FONT_SIZE, color: toCssColor(getTheme().colors.primary) })
      .setOrigin(0.5)
    this.overlay.panel.add(this.title)

    this.sfx = createSlider(this, {
      label: t('sound'),
      value: sfxVolume(),
      restore: sfxRestoreLevel,
      onChange: (value) => setSfxVolume(value),
      // §9's main sound, at the level just chosen. A fader for game audio should be set against the
      // sound the game actually makes, not against silence — and this is the one the player will
      // hear most. Fired on release only: per-pixel it would be a machine gun.
      onCommit: (value) => {
        if (value > 0) playSfx(SFX.capture)
      },
    })
    this.music = createSlider(this, {
      label: t('music'),
      value: musicVolume(),
      restore: musicRestoreLevel,
      onChange: (value) => setMusicVolume(value),
    })
    for (const object of [...this.sfx.objects, ...this.music.objects]) this.overlay.panel.add(object)

    this.closeButton = gameButton(this, { size: 'compact', variant: 'ghost', label: t('close') })
    this.overlay.panel.add(this.closeButton.container)
    bindAction(this, 'close', { pointer: this.closeButton.hitArea, keys: ['ESC', 'ENTER'] }, () => this.close())

    bindLayout(this, (width, height) => this.layout(width, height))
    this.overlay.open()
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)
    // Clamped to the viewport as well as scaled. `uiScale` floors at 0.8, so on a viewport narrower
    // than 272 + margin the panel would otherwise hang off both edges — and since the sliders now
    // size themselves from the row width they are given, a narrower panel costs a shorter track and
    // nothing else.
    const panelWidth = Math.min(PANEL_WIDTH * scale, width - 32)
    const panelHeight = PANEL_HEIGHT * scale

    this.overlay.layout(width, height)
    this.overlay.drawPanel(panelWidth, panelHeight, scale, getTheme().colors.secondary)

    this.title.setFontSize(TITLE_FONT_SIZE * scale)
    this.title.setPosition(0, -panelHeight / 2 + 34 * scale)

    // Both sliders share one left edge so their labels, tracks and readouts line up as a column —
    // two faders that do not agree on where they start read as two unrelated controls. They are also
    // told how wide the row is rather than assuming it: see `ui/slider.ts`'s `MIN_TRACK_WIDTH`.
    const left = -panelWidth / 2 + PANEL_PADDING * scale
    const rowWidth = panelWidth - PANEL_PADDING * 2 * scale

    // Row centres. A row is as tall as its 64-unit mute button, so these are 80 apart to leave 16
    // between them, and the second sits 13 clear of the Close button's top edge at 91.
    this.sfx.layout(left, -34 * scale, scale, rowWidth)
    this.music.layout(left, 46 * scale, scale, rowWidth)

    this.closeButton.layout(0, panelHeight / 2 - 46 * scale, scale)
  }

  private close(): void {
    this.overlay.close(() => {
      this.scene.stop()

      if (isPlatformPaused()) {
        // Resuming now would unfreeze a scene the platform still considers suspended; the real
        // RESUME will do it.
        this.game.events.once(YTEvents.RESUME, () => {
          this.scene.resume(this.openerKey)
        })
        return
      }

      this.scene.resume(this.openerKey)
    })
  }
}
