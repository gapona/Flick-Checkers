import * as Phaser from 'phaser'
import { fitScale } from '../ui/fit'
import { bindLayout } from '../ui/layout'
import { ATLAS_KEY, AUDIO_KEYS, audioPath, backgroundKey, backgroundPath, MASCOT_BLINK_KEY, MASCOT_BLINK_PATH, MASCOT_KEY, MASCOT_PATH, MENU_BACKGROUND_KEY, MENU_BACKGROUND_PATH, SKIN_IDS } from '../assets'
import { DAILY_CATALOG_KEY, DAILY_CATALOG_PATH } from '../daily/catalog'
import { VOICE_SPRITE_KEY } from '../audio/audio'
import { PORTRAIT_ATLAS_KEY } from '../ui/portrait'
import { t } from '../i18n/strings'
import { getTheme } from '../ui/theme'
import { createFlyingDiscs, type FlyingDiscs } from '../ui/flyingDiscs'
import { createTitleLockup, type TitleLockup } from '../ui/titleLockup'
import { uiScale } from '../ui/uiScale'

const MAX_BAR_WIDTH = 468
const BAR_HEIGHT = 12
// Keeps the bar off the edges on narrow viewports (e.g. 390px wide) instead of
// overflowing them at a fixed 468px.
const BAR_MARGIN = 40
const TITLE_FONT_SIZE = 34
const TITLE_SIDE_MARGIN = 24
/** The bar sits this far below the lockup — far enough that the two read as separate things. */
const BAR_DROP = 120

/**
 * **Everything on this screen is computed, and it has to be.**
 *
 * The loading screen is the one place in the game that cannot load anything: it IS the load. No
 * atlas, no background plate, no sound. What it can have is what costs nothing to have — the disc
 * textures, which `board/discTextures.ts` draws at runtime from a palette rather than loading, and
 * the display font, which `main.ts` awaits before the first scene exists. That is enough for a
 * wordmark and a drift of discs, which is the whole screen.
 *
 * It also matters more than its share: it is the first thing a player sees and the one screen a
 * certification reviewer is guaranteed to reach. It used to be a white rectangle on a flat colour.
 */

export class Preloader extends Phaser.Scene {
  private track!: Phaser.GameObjects.Graphics
  private bar!: Phaser.GameObjects.Graphics
  private barWidth = MAX_BAR_WIDTH
  private barY = 0
  private progress = 0
  private title!: TitleLockup
  private discs!: FlyingDiscs

  constructor() {
    super('Preloader')
  }

  init() {
    // Built in init(), not create(): preload()'s 'progress' events fire between init()
    // and create(), so all of this has to exist before that to have anything to update.
    this.discs = createFlyingDiscs(this, { count: 20 })
    this.title = createTitleLockup(this, t('gameTitle'), TITLE_FONT_SIZE)
    this.track = this.add.graphics()
    this.bar = this.add.graphics()

    this.load.on('progress', (progress: number) => {
      this.progress = progress
      this.layoutBar()
    })

    bindLayout(this, (width, height) => this.layout(width, height))
  }

  preload() {
    this.load.setPath('assets')
    // Every sprite in the game comes from one atlas (CONCEPT.md §6.2) — board squares, the gold
    // rim, pieces and crowns, highlights, particles and UI. Regenerate both files with
    // `npm run assets`; see scripts/make-atlas.mjs.
    this.load.atlas(ATLAS_KEY, 'atlas/game.webp', 'atlas/game.json')
    // One background per skin, kept out of the atlas because it is a full-screen image, not a
    // sprite (CONCEPT.md §6.4). ALL of them are loaded up front, not just the equipped one: they
    // are ~14 KB each blurred, and loading on demand would mean a skin swap that shows an empty
    // background for a frame — or a loading state inside a cosmetic menu.
    for (const skin of SKIN_IDS) this.load.image(backgroundKey(skin), backgroundPath(skin))
    // The menu's own plate and its mascot. Loaded here with everything else rather than by the menu
    // itself: `MainMenu` is the scene this one hands off to, and a menu that opens without its own
    // background is a menu that flashes.
    this.load.image(MENU_BACKGROUND_KEY, MENU_BACKGROUND_PATH)
    this.load.image(MASCOT_KEY, MASCOT_PATH)
    // Both frames of the idle, together: a blink that arrives after the menu does would show the
    // character opening its eyes for the first time some seconds in.
    this.load.image(MASCOT_BLINK_KEY, MASCOT_BLINK_PATH)
    // The whole sound set, Ogg Vorbis, ~124 KB together (CONCEPT.md §8/S10). All of it is loaded
    // here: a capture sound that arrives after the first capture is worse than no sound at all.
    for (const key of AUDIO_KEYS) this.load.audio(key, audioPath(key))
    // The daily puzzles, generated and proved by `npm run daily` (GAME-PLAN.md §7). A few KB of
    // JSON, loaded up front rather than on demand: the Daily screen must open instantly, and a
    // "loading" state inside a one-shot puzzle would be absurd.
    this.load.json(DAILY_CATALOG_KEY, DAILY_CATALOG_PATH)
    // The opponents' syllable sprite (`scripts/make-voice.py`), ~49 KB. An audio SPRITE, so it needs
    // its marker JSON alongside the stream — `audioSprite` takes both and `playVoiceMarker` fails
    // safe if either is missing rather than taking the match down.
    this.load.audioSprite(VOICE_SPRITE_KEY, 'voice/voice.json', ['voice/voice.ogg'])
    // The cast's faces. One atlas for all of them: eight images at ~15 KB each would be eight
    // requests and eight decodes for content that is always shown together, in a list.
    this.load.atlas(PORTRAIT_ATLAS_KEY, 'portraits/portraits.webp', 'portraits/portraits.json')
  }

  create() {
    this.scene.start('MainMenu')
  }

  update(_time: number, delta: number): void {
    this.discs.update(delta)
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)
    this.discs.layout(width, height)

    // Measured on the whole lockup, discs included — same rule as `MainMenu`.
    this.title.setFontSize(TITLE_FONT_SIZE * scale)
    this.title.setFontSize(TITLE_FONT_SIZE * scale * fitScale(this.title.width, width - TITLE_SIDE_MARGIN * 2))
    this.title.layout(width / 2, height / 2 - BAR_DROP * scale * 0.35)

    this.barWidth = Math.min(MAX_BAR_WIDTH, width - BAR_MARGIN * 2)
    this.barY = height / 2 + BAR_DROP * scale * 0.65
    this.layoutBar()
  }

  /** Track and fill, redrawn together: two rounded bars is less code than keeping two retained
   * objects in step with a width that changes on every progress event AND every resize. */
  private layoutBar(): void {
    const left = (this.scale.width - this.barWidth) / 2
    const radius = BAR_HEIGHT / 2
    const colors = getTheme().colors

    this.track.clear()
    this.track.fillStyle(colors.surface, 0.85)
    this.track.fillRoundedRect(left, this.barY - BAR_HEIGHT / 2, this.barWidth, BAR_HEIGHT, radius)

    this.bar.clear()
    // Nothing is drawn at zero: a rounded rect narrower than its own corner radius renders as a
    // lozenge that looks like progress the loader has not actually made.
    const filled = this.barWidth * this.progress
    if (filled < BAR_HEIGHT) return
    this.bar.fillStyle(colors.accent, 1)
    this.bar.fillRoundedRect(left, this.barY - BAR_HEIGHT / 2, filled, BAR_HEIGHT, radius)
  }
}
