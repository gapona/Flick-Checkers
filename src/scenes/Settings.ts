import * as Phaser from 'phaser'
import { SFX } from '../assets'
import { musicRestoreLevel, musicVolume, playSfx, setMusicVolume, setSfxVolume, sfxRestoreLevel, sfxVolume } from '../audio/audio'
import { t } from '../i18n/strings'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { gameButton, type GameButton } from '../ui/button'
import { navTo } from '../ui/chrome'
import { createOverlay, type Overlay } from '../ui/overlay'
import { createSlider, type Slider } from '../ui/slider'
import { getTheme, toCssColor } from '../ui/theme'
import { uiScale } from '../ui/uiScale'
import { raiseOverlay } from '../platform/lifecycle'

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
 *
 * **404 now, because a third button joined the stack.** How-to-play is a full page rather than an
 * overlay (see `scenes/HowToPlay.ts`), so it needs a row here rather than a second panel: 330 + a
 * 62-unit button + 12 of gap. Redo the same addition before adding a fourth — this panel is not
 * clamped to the viewport's HEIGHT the way it is to its width, so growth here is paid for on a short
 * landscape screen.
 */
const PANEL_HEIGHT = 404
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
  private helpButton!: GameButton
  private closeButton!: GameButton

  constructor() {
    super('Settings')
  }

  create(data: SettingsData) {
    // Above every other scene, whatever order `config.ts` registered them in — see
    // `raiseOverlay`, and the four dead buttons that came of not doing this.
    raiseOverlay(this)

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

    /**
     * The one entry point to the rules that exists on every screen, mid-match included.
     *
     * That is why it is HERE rather than on the menu: "what does this button actually do" is a
     * question asked with a board in front of you, and the gear is the only control every screen
     * carries. The menu's own offer (`MainMenu`) is a different thing — a first-run nudge toward the
     * hands-on tutorial, which goes away once it has been taken.
     */
    this.helpButton = gameButton(this, { size: 'compact', variant: 'plum', label: t('howToPlay') })
    this.overlay.panel.add(this.helpButton.container)
    bindAction(this, 'openHelp', { pointer: this.helpButton.hitArea, keys: ['H'] }, () => this.openHelp())

    this.closeButton = gameButton(this, { size: 'compact', variant: 'ghost', label: t('close') })
    this.overlay.panel.add(this.closeButton.container)
    bindAction(this, 'close', { pointer: this.closeButton.hitArea, keys: ['ESC', 'ENTER'] }, () => this.close())

    bindLayout(this, (width, height) => this.layout(width, height))
    this.overlay.open()
  }

  layout(width: number, height: number): void {
    /**
     * **The panel is sized on BOTH axes, and it was sized on one.**
     *
     * `uiScale` reads the WIDTH, which is the right question for text on a phone and the wrong one
     * for a panel whose height is a fixed stack of rows. At 740x360 — a landscape phone — `uiScale`
     * returns 1, the 404-unit panel is centred on 360px of screen, and its title lands one pixel
     * above the top of the viewport. `tests/platform/layout.test.ts` caught exactly that, the moment
     * the help button made the stack taller.
     *
     * So the panel takes the SMALLER of the two: the width's scale, and whatever the height can
     * actually pay for. Everything inside is laid out in the same units, so shrinking the panel
     * shrinks the whole thing proportionally rather than rearranging it — and the buttons' tap
     * targets do not shrink with it, since `gameButton` floors every hit area at `MIN_TOUCH_TARGET`.
     *
     * The 0.6 floor is where legibility gives out; below it the panel is allowed to overflow, on the
     * same principle as `MainMenu`'s column. A viewport under 275px tall is not a target.
     */
    const scale = Math.min(uiScale(width), Math.max(0.6, (height - 32) / PANEL_HEIGHT))
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

    // Row centres, still 80 apart so a 64-unit row leaves 16 between them — moved up bodily by the
    // 74 units the help button added. Checked at scale 1 against a 404 panel: title 18 clear of the
    // top, sliders 49 and 22 clear of their neighbours, help 6 clear of Close, Close 9 clear of the
    // bottom.
    this.sfx.layout(left, -71 * scale, scale, rowWidth)
    this.music.layout(left, 9 * scale, scale, rowWidth)

    this.helpButton.layout(0, panelHeight / 2 - 108 * scale, scale)
    this.closeButton.layout(0, panelHeight / 2 - 40 * scale, scale)
  }

  /**
   * Leaves for the rules page — and it does so through the OPENER, not through this scene.
   *
   * `navTo` records where "back" should land by reading the scene it is given, so handing it this
   * overlay would put `Settings` on the stack and send the back button to a panel that no longer
   * exists. It is given the opener instead, which is also the scene `scene.start` has to be called
   * from: an overlay cannot navigate out of a scene it is merely sitting on top of.
   *
   * **`{ resume: true }` when that opener is `Game`**, exactly as the side panel's shop button does.
   * Without it the back button out of the rules page would start a brand-new match over the saved
   * one, silently — which is the bug `ui/chrome.ts`'s `NavEntry` was given return data to prevent.
   */
  private openHelp(): void {
    const openerKey = this.openerKey
    const opener = this.scene.get(openerKey)
    this.overlay.close(() => {
      this.scene.stop()
      navTo(opener, 'HowToPlay', undefined, openerKey === 'Game' ? { resume: true } : undefined)
    })
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
