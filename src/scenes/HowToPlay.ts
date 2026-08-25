import * as Phaser from 'phaser'
import { ALL_RULE_SETS, type RulesId } from '../game/rules'
import { FORMATION_ORDER } from '../game/formations'
import { coinBalance } from '../game/wallet'
import { HELP_CHAPTERS, type HelpChapter } from '../game/tutorial'
import { resetTour } from '../game/tour'
import { t, type StringKey } from '../i18n/strings'
import { bindAction } from '../platform/input'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { buttonHeight, buttonWidth, gameButton, type GameButton } from '../ui/button'
import {
  contentColumn,
  createPageBackground,
  createTopBar,
  navBack,
  navReturnsTo,
  navMarkRoot,
  PAGE_FILL,
  type PageBackground,
  type TopBar,
} from '../ui/chrome'
import { listHeightBetween, scrollableCameraRegion, type ScrollableCameraRegion } from '../ui/scrollRegion'
import {
  computeReleaseVelocity,
  createScrollMomentumState,
  pushDragSample,
  resetScrollMomentum,
  stepMomentum,
  type ScrollMomentumState,
} from '../ui/scrollMomentum'
import { uiScale } from '../ui/uiScale'

const CHAPTER_GAP = 22
const PARAGRAPH_GAP = 8
const HEADING_GAP = 10
const TITLE_FONT_SIZE = 19
const BODY_FONT_SIZE = 14
/** The bullet list a chapter can pull from the game's own data — a name in the body colour with its
 * own line under it, indented so the two read as one entry rather than as two paragraphs. */
const ENTRY_GAP = 6
const ENTRY_INDENT = 12

/** `Modes`' numbers, for the same widget. */
const SCROLLBAR_WIDTH = 4
const SCROLLBAR_GAP = 5
const SCROLLBAR_MIN_THUMB = 28
const SCROLLBAR_TRACK_ALPHA = 0.18
const SCROLLBAR_THUMB_ALPHA = 0.75
const SCROLLBAR_COLOR = 0x5a2394

/** The fade at each open end of the list — see `drawEdgeFades`. Design units, banded rather than a
 * gradient so it looks the same under the Canvas fallback. */
const FADE_DEPTH = 28
const FADE_BANDS = 8
const FADE_ALPHA = 0.92

const TITLE_COLOR = '#ffc23c'
const BODY_COLOR = '#c9b6e4'
const ENTRY_COLOR = '#e6d8f5'

/**
 * The reference: everything the tutorial's board cannot demonstrate.
 *
 * ## Why a second screen and not more lessons
 *
 * `scenes/Tutorial.ts` teaches by making the player do something, which works for the gesture, the
 * reach and the cost of losing a disc, and works for nothing else. There is no way to teach the shop
 * by making somebody play it, and a "lesson" that is a wall of text over a board is a worse page
 * than a page. So the split is by KIND: doing there, reading here.
 *
 * ## Two chapters are built from the game's own data
 *
 * The four rule sets and the five branches of arms are already written down for the screens that
 * pick them, and a help screen that restated them would be a second copy free to drift from the
 * first — the exact failure `scripts/render-skin-sheet.mjs` was caught in when its board drifted
 * from the product's. So `HelpChapter.source` names a list and this scene reads `ALL_RULE_SETS` and
 * `FORMATION_ORDER` directly. Adding a mode adds a row here for free; renaming one cannot leave a
 * stale name behind.
 *
 * ## A full page, not an overlay, and that is what makes `Settings` able to reach it
 *
 * Settings is an overlay over an arbitrary opener, so it cannot host a second overlay without
 * arbitrating two pause owners over one scene. As a NAV destination it is reached with `navTo`
 * instead, which the settings panel can drive on its opener's behalf — carrying `{ resume: true }`
 * when that opener is `Game`, exactly as the side panel's shop button does, so a player who asks
 * "what does this button do" mid-match comes back to the same board.
 */
export class HowToPlay extends Phaser.Scene {
  private topBar!: TopBar
  private pageBackground!: PageBackground
  private region!: ScrollableCameraRegion
  private scrollState!: ScrollMomentumState
  private scrollY = 0
  private maxScroll = 0
  private dragging = false
  private dragOrigin = 0
  private scrollOrigin = 0

  /** Every text object in the list, in draw order, each with the indent it is laid out at. Flat
   * rather than grouped by chapter: nothing here needs to address a chapter after it is built, and a
   * flat list makes `layout()` one loop. */
  private rows: { text: Phaser.GameObjects.Text; size: number; indent: number; gapAbove: number }[] = []
  private tutorialButton?: GameButton
  private tourButton!: GameButton

  private scrollbar!: Phaser.GameObjects.Graphics
  private scrollbarTrack = { x: 0, width: 0, height: 0 }
  private leaving = false

  constructor() {
    super('HowToPlay')
  }

  create() {
    // Cleared explicitly — Phaser re-uses the scene INSTANCE, and a stale array would hand `layout`
    // objects destroyed on the previous SHUTDOWN. See `MatchResult`'s header for the full version of
    // this bug.
    this.rows = []
    this.tutorialButton = undefined
    this.scrollY = 0
    this.dragging = false
    this.leaving = false
    this.scrollState = createScrollMomentumState()

    this.pageBackground = createPageBackground(this)
    this.topBar = createTopBar(this, { back: true, onBack: () => navBack(this), onSettings: () => this.openSettings() })
    this.topBar.setCoins(coinBalance())

    for (const chapter of HELP_CHAPTERS) this.buildChapter(chapter)

    /**
     * The hands-on half, offered from the reading half — but **not while there is a match to come
     * back to.**
     *
     * `Tutorial` is a full scene and starting it would stop `Game`, and while the match itself
     * survives (it is persisted after every settled shot) the nav stack's return entry would not:
     * the player would land back on the menu holding a Continue instead of on the board they left.
     * Somebody who opened this mid-round wanted the paragraph, not a change of activity.
     */
    /**
     * The guided tour again, from the one screen that is reachable everywhere.
     *
     * **It does not launch `Coach` itself.** The tour rings controls on the screen it is about, and
     * this page has none of them — so the button forgets the chapters (`game/tour.ts`) and LEAVES,
     * and whichever host the back button lands on opens the tour in its own `create()`. That is one
     * seam rather than a branch per caller, and it means the match half opens over a board and the
     * menu half over the menu, whichever door the player came in through.
     *
     * Unconditional, unlike the lessons beside it: `navBack` restores `Game` with its `{ resume:
     * true }` return data, so a player who asks mid-match comes back to the same board with the tour
     * over it. Nothing is lost and nothing is restarted.
     */
    this.tourButton = gameButton(this, { size: 'compact', variant: 'plum', label: t('tourReplay') })
    bindAction(this, 'replayTour', { pointer: this.tourButton.hitArea, keys: ['T'] }, () => {
      if (this.leaving) return
      this.leaving = true
      resetTour()
      navBack(this)
    })

    if (navReturnsTo(this) !== 'Game') {
      // `compact`, not `primary`: this screen's content is the reading, and a 72-unit button pinned
      // to the bottom takes 88px of a 390-tall landscape phone away from the thing people came for.
      // Gold still — it is the one call to action here — just not the size of one.
      this.tutorialButton = gameButton(this, { size: 'compact', variant: 'gold', label: t('tutorialPlay') })
      bindAction(this, 'playTutorial', { pointer: this.tutorialButton.hitArea, keys: ['ENTER'] }, () => {
        if (this.leaving) return
        this.leaving = true
        // The tutorial ends on its own three-way panel, which navigates from a cleared stack — so a
        // back button pointing here would be pointing at a page the player has already left.
        navMarkRoot(this)
        this.scene.start('Tutorial')
      })
    }

    // Clipped by a dedicated camera's VIEWPORT. `setMask()` with a GeometryMask is a silent no-op
    // under WebGL in this Phaser build (CLAUDE.md "Scroll Patterns") — the chapters would simply
    // escape the region and draw over the top bar.
    this.region = scrollableCameraRegion(this, { x: 0, y: 0, width: 1, height: 1 })
    this.scrollbar = this.add.graphics()
    this.bindScroll()

    bindLayout(this, (width, height) => this.layout(width, height))
  }

  private openSettings(): void {
    this.scene.pause()
    this.scene.launch('Settings', { opener: 'HowToPlay' })
  }

  // -- building the list -----------------------------------------------------------------------

  private heading(key: StringKey, gapAbove: number): void {
    this.rows.push({
      text: this.add.text(0, 0, t(key), { fontFamily: getDisplayFontStack(), fontSize: TITLE_FONT_SIZE, color: TITLE_COLOR }).setOrigin(0, 0),
      size: TITLE_FONT_SIZE,
      indent: 0,
      gapAbove,
    })
  }

  private paragraph(line: string, indent: number, gapAbove: number, color: string = BODY_COLOR): void {
    this.rows.push({
      text: this.add.text(0, 0, line, { fontFamily: 'Arial', fontSize: BODY_FONT_SIZE, color, wordWrap: { width: 200 } }).setOrigin(0, 0),
      size: BODY_FONT_SIZE,
      indent,
      gapAbove,
    })
  }

  private buildChapter(chapter: HelpChapter): void {
    this.heading(chapter.titleKey, this.rows.length === 0 ? 0 : CHAPTER_GAP)
    chapter.bodyKeys.forEach((key, index) => {
      this.paragraph(t(key), 0, index === 0 ? HEADING_GAP : PARAGRAPH_GAP)
    })

    if (chapter.source === 'rules') {
      for (const set of ALL_RULE_SETS) {
        this.paragraph(t(ruleNameKey(set.id)), ENTRY_INDENT, PARAGRAPH_GAP + ENTRY_GAP, ENTRY_COLOR)
        this.paragraph(t(ruleAboutKey(set.id)), ENTRY_INDENT, ENTRY_GAP)
      }
    }
    if (chapter.source === 'branches') {
      for (const formation of FORMATION_ORDER) {
        this.paragraph(t(branchNameKey(formation)), ENTRY_INDENT, PARAGRAPH_GAP + ENTRY_GAP, ENTRY_COLOR)
        this.paragraph(t(branchAboutKey(formation)), ENTRY_INDENT, ENTRY_GAP)
      }
    }
  }

  // -- scrolling -------------------------------------------------------------------------------

  /** `Modes`' handler, unchanged — including the reason samples carry the POINTER EVENT's own
   * timestamp rather than a scene clock (see `ui/scrollMomentum.ts`'s regression test). */
  private bindScroll(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.dragging = true
      this.dragOrigin = pointer.y
      this.scrollOrigin = this.scrollY
      resetScrollMomentum(this.scrollState)
      pushDragSample(this.scrollState, pointer.y, pointer.event.timeStamp)
    })
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging) return
      this.scrollY = Phaser.Math.Clamp(this.scrollOrigin - (pointer.y - this.dragOrigin), 0, this.maxScroll)
      this.region.camera.setScroll(0, this.scrollY)
      this.drawScrollbar()
      pushDragSample(this.scrollState, pointer.y, pointer.event.timeStamp)
    })
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!this.dragging) return
      this.dragging = false
      // Negated: dragging the content UP (decreasing pointer y) scrolls the list DOWN.
      this.scrollState.velocity = -computeReleaseVelocity(this.scrollState)
    })
  }

  update(time: number, delta: number): void {
    if (this.dragging || this.scrollState.velocity === 0) return
    this.scrollY = stepMomentum(this.scrollState, this.scrollY, delta, 0, this.maxScroll, time)
    this.region.camera.setScroll(0, this.scrollY)
    this.drawScrollbar()
  }

  /**
   * Drawn INSIDE the region with the camera's own scroll added back.
   *
   * On the main camera it would not be misplaced, it would be ABSENT: a later camera's viewport does
   * not composite over the earlier one, it owns those pixels. See "Scroll Patterns".
   *
   * This list is longer than any viewport by a wide margin, so unlike `Modes`' the bar is effectively
   * always drawn — the `maxScroll <= 0` guard stays because a scrollbar that cannot move is furniture
   * and the rule should not depend on how much copy happens to be in the dictionary.
   */
  /**
   * A soft fade at whichever end of the list still has copy beyond it.
   *
   * **The list is clipped by a camera VIEWPORT, which is a hard edge**: a paragraph running past the
   * bottom is not faded or cropped at a word, it is sliced across the middle of a line of type,
   * directly above the two buttons. Reported as the page cutting its buttons off — the complaint is
   * about the seam, and the seam is what makes a clean layout look broken. A gradient says "there is
   * more of this below" in the one place a scrollbar cannot, which is where the eye already is.
   *
   * **Banded, not `fillGradientStyle`.** That call is WebGL-only in this Phaser build and degrades to
   * a flat fill under the Canvas fallback — which here would be an opaque bar across the bottom of
   * the page rather than a fade. The same "no shader, works identically under Canvas" rule the widget
   * kit holds itself to. Eight bands is enough that the steps are invisible at this alpha.
   *
   * Drawn INSIDE the region with the camera's scroll added back, for the reason `drawScrollbar` gives.
   */
  private drawEdgeFades(): void {
    const { height } = this.scrollbarTrack
    if (height <= 0) return
    const depth = Math.min(FADE_DEPTH * uiScale(this.scale.width), height / 3)
    const band = depth / FADE_BANDS
    const width = this.scale.width

    // Only where there is something to fade INTO. At the very bottom of the list the seam is the end
    // of the text, and fading it would be dimming the last paragraph for no reason.
    const below = this.maxScroll - this.scrollY
    for (let i = 0; i < FADE_BANDS; i += 1) {
      const alpha = ((i + 1) / FADE_BANDS) * FADE_ALPHA
      if (below > 1) {
        this.scrollbar.fillStyle(PAGE_FILL, alpha)
        this.scrollbar.fillRect(0, this.scrollY + height - band * (i + 1), width, band)
      }
      if (this.scrollY > 1) {
        this.scrollbar.fillStyle(PAGE_FILL, alpha)
        this.scrollbar.fillRect(0, this.scrollY + band * i, width, band)
      }
    }
  }

  private drawScrollbar(): void {
    this.scrollbar.clear()
    this.drawEdgeFades()
    if (this.maxScroll <= 0) return

    const { x, width, height } = this.scrollbarTrack
    const radius = width / 2
    const y = this.scrollY

    this.scrollbar.fillStyle(SCROLLBAR_COLOR, SCROLLBAR_TRACK_ALPHA)
    this.scrollbar.fillRoundedRect(x, y, width, height, radius)

    const visible = height / (height + this.maxScroll)
    const thumb = Math.max(SCROLLBAR_MIN_THUMB, height * visible)
    const at = y + (height - thumb) * (this.scrollY / this.maxScroll)
    this.scrollbar.fillStyle(SCROLLBAR_COLOR, SCROLLBAR_THUMB_ALPHA)
    this.scrollbar.fillRoundedRect(x, at, width, thumb, radius)
  }

  // -- layout ----------------------------------------------------------------------------------

  layout(width: number, height: number): void {
    this.pageBackground.resize(width, height)
    const scale = uiScale(width)
    const column = contentColumn(width)
    const left = (width - column) / 2

    this.topBar.layout(width, height)
    const top = this.topBar.height(this)

    /**
     * The buttons are pinned to the bottom and the LIST takes what is left. A control the player has
     * to reach must not be the thing that scrolls away.
     *
     * Two of them side by side where the width pays for it, stacked where it does not — a pair of
     * 168-unit buttons plus their gap wants 348, which every phone this game targets has and a 320
     * one does not once the margins are paid. Measured rather than assumed: the same arithmetic done
     * once by division put the side panel's pairs one pixel over their own panel.
     */
    const buttonH = buttonHeight('compact', scale)
    const buttonW = buttonWidth('compact', scale)
    const buttonGap = 12 * scale
    const pairFits = !this.tutorialButton || buttonW * 2 + buttonGap <= width - 32 * scale
    const rows = this.tutorialButton && !pairFits ? 2 : 1
    const blockH = buttonH * rows + (rows - 1) * buttonGap
    const blockTop = height - 16 * scale - blockH

    const listTop = top + 8 * scale
    // `listHeightBetween`, not `Math.max(80, ...)`: a floor hands out pixels the screen does not
    // have, which is how all three of this game's lists came to overrun the bar below them in
    // landscape. See `ui/scrollRegion.ts`.
    const listHeight = listHeightBetween(listTop, blockTop - 12 * scale)
    this.region.setBounds({ x: 0, y: listTop, width, height: listHeight })

    // Rows are laid out at their TRUE, unscrolled positions and the camera pans over them — the
    // whole point of a camera-viewport clip is that scrolled content is positioned once.
    let y = 0
    for (const row of this.rows) {
      const indent = row.indent * scale
      // The row carries its own design size. Reading it back off the `Text` would ask the object
      // for a number it was last SET to, which after one resize is the previous scale's.
      row.text.setFontSize(row.size * scale)
      row.text.setWordWrapWidth(column - indent - 20 * scale)
      y += row.gapAbove * scale
      row.text.setPosition(left + indent, y)
      y += row.text.height
    }

    const contentHeight = y + 24 * scale
    this.maxScroll = Math.max(0, contentHeight - listHeight)
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScroll)
    this.region.camera.setScroll(0, this.scrollY)

    // Mutual ignore lists. An object in NEITHER renders in BOTH, which here would draw the whole
    // reference a second time over the top bar at its unscrolled position.
    const listObjects = this.rows.map((row) => row.text)
    const chrome = [...this.topBar.objects, this.tourButton.container, ...(this.tutorialButton ? [this.tutorialButton.container] : [])]
    this.region.camera.ignore(chrome)
    // The bar belongs to the LIST's camera, not the main one — see `drawScrollbar`.
    this.cameras.main.ignore([...listObjects, this.scrollbar])

    this.scrollbarTrack = { x: left + column + SCROLLBAR_GAP * scale, width: SCROLLBAR_WIDTH * scale, height: listHeight }
    this.drawScrollbar()

    const firstRowY = blockTop + buttonH / 2
    if (!this.tutorialButton) {
      this.tourButton.layout(width / 2, firstRowY, scale)
    } else if (pairFits) {
      // Gold on the right, where the primary answer sits everywhere else in this game.
      this.tourButton.layout(width / 2 - (buttonW + buttonGap) / 2, firstRowY, scale)
      this.tutorialButton.layout(width / 2 + (buttonW + buttonGap) / 2, firstRowY, scale)
    } else {
      this.tutorialButton.layout(width / 2, firstRowY, scale)
      this.tourButton.layout(width / 2, firstRowY + buttonH + buttonGap, scale)
    }
  }
}

function ruleNameKey(id: RulesId): StringKey {
  switch (id) {
    case 'classic':
      return 'ruleNameClassic'
    case 'bumper':
      return 'ruleNameBumper'
    case 'blitz':
      return 'ruleNameBlitz'
    case 'pits':
      return 'ruleNamePits'
  }
}

function ruleAboutKey(id: RulesId): StringKey {
  switch (id) {
    case 'classic':
      return 'ruleAboutClassic'
    case 'bumper':
      return 'ruleAboutBumper'
    case 'blitz':
      return 'ruleAboutBlitz'
    case 'pits':
      return 'ruleAboutPits'
  }
}

function branchNameKey(id: (typeof FORMATION_ORDER)[number]): StringKey {
  switch (id) {
    case 'infantry':
      return 'formationInfantry'
    case 'cavalry':
      return 'formationCavalry'
    case 'artillery':
      return 'formationArtillery'
    case 'tanks':
      return 'formationTanks'
    case 'planes':
      return 'formationPlanes'
  }
}

function branchAboutKey(id: (typeof FORMATION_ORDER)[number]): StringKey {
  switch (id) {
    case 'infantry':
      return 'branchInfantryAbout'
    case 'cavalry':
      return 'branchCavalryAbout'
    case 'artillery':
      return 'branchArtilleryAbout'
    case 'tanks':
      return 'branchTanksAbout'
    case 'planes':
      return 'branchPlanesAbout'
  }
}
