import * as Phaser from 'phaser'
import { ensureModeIcon, MODE_ICON_SIZE } from '../board/modeIcon'
import { ALL_RULE_SETS, getRuleSet, type RulesId } from '../game/rules'
import { currentRulesId, rememberRuleSet } from '../game/persistence'
import { coinBalance } from '../game/wallet'
import { t, type StringKey } from '../i18n/strings'
import { bindAction } from '../platform/input'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { buttonHeight, gameButton, type GameButton } from '../ui/button'
import { contentColumn, createPageBackground, createTopBar, navBack, type PageBackground, type TopBar } from '../ui/chrome'
import { createNavBar, type NavBar } from '../ui/navBar'
import { listHeightBetween, scrollableCameraRegion, type ScrollableCameraRegion } from '../ui/scrollRegion'
import { computeReleaseVelocity, createScrollMomentumState, pushDragSample, resetScrollMomentum, stepMomentum, type ScrollMomentumState } from '../ui/scrollMomentum'
import { uiScale } from '../ui/uiScale'

/**
 * A FLOOR, not a height — the card grows to fit its own copy, which differs by mode and by language.
 * This only stops a short card collapsing to nothing.
 */
const CARD_MIN_HEIGHT = 84
/** Under this, the list cannot show a whole card and the section heading is dropped to buy room.
 * One card runs 80-135px tall depending on how long its copy wraps. */
const COMFORTABLE_LIST_HEIGHT = 80

const CARD_GAP = 12
const CARD_PADDING = 16
const CARD_RADIUS = 14
const TITLE_FONT_SIZE = 18
const ABOUT_FONT_SIZE = 13
const SECTION_FONT_SIZE = 14

/**
 * The scrollbar, in `Shop`'s own numbers — the same widget for the same reason.
 *
 * Four rule-set cards fit most viewports and overflow the short ones, so it is drawn only when it
 * has somewhere to go (see {@link Modes.drawScrollbar}); a scrollbar that cannot move is furniture.
 */
const SCROLLBAR_WIDTH = 4
const SCROLLBAR_GAP = 5
const SCROLLBAR_MIN_THUMB = 28
const SCROLLBAR_TRACK_ALPHA = 0.18
const SCROLLBAR_THUMB_ALPHA = 0.75

const CARD_FILL = 0x241040
const CARD_FILL_SELECTED = 0x33195c
const CARD_STROKE = 0x5a2394
const CARD_STROKE_SELECTED = 0xffc23c
const CHECK_COLOR = '#ffc23c'
/** The win line is set in the same gold the check mark uses, not the muted grey the flavour text
 * uses: it is the one line on the card a player is actually looking for. */
const WIN_COLOR = CHECK_COLOR
const LABEL_COLOR = '#e6d8f5'
const MUTED_COLOR = '#a892c4'

/**
 * Picking how to play: a rule set and a bot level.
 *
 * ## It is a navigation destination now, not an overlay
 *
 * It used to be `launch()`-ed over a paused menu. As a bottom-navigation tab it is a full scene
 * with its own top bar, which is what lets it be one tap away instead of two and what lets the back
 * button behave.
 *
 * ## Step one of two, and it no longer holds the cast
 *
 * It used to be one scrolling column: four rule-set cards with the whole cast underneath them.
 * That is two different questions stacked in one list — and on every viewport the game targets the
 * second question was below the fold, so the ladder was the half nobody scrolled to. Choosing a mode
 * now opens `Opponents`, a popup over this screen, and the match starts from there. The consequences
 * worth keeping in mind: this screen never starts a match itself, it hands off; and the popup names
 * the mode it was opened with, so the two halves of the decision cannot come apart.
 *
 * `MainMenu`'s New match still arrives here rather than dropping the player into whichever rule set
 * was last saved. It is reachable BOTH ways (as a nav tab and as the New-match step) and behaves
 * identically in both, which is why the button below is unconditional. It never resumes: a saved
 * match is Continue's job, on the menu.
 *
 * ## What the cards show, and why the icon is not decoration
 *
 * Every card carries a miniature of the board its rule set actually produces
 * (`board/modeIcon.ts`). "Your disc flies off the edge" against "your disc bounces back" is a
 * sentence nobody reads and a picture everybody sees, and the same is true of the pits.
 *
 * ## Deviation from the brief, stated
 *
 * `PROMPT-UI.md`'s chunk 6 names four cards — Classic, Bumpers, Timed duel, Daily. Three now
 * map exactly onto shipped rule sets (the timed one is `blitz`); the daily is not a rule set at all
 * but a separate scene with its own entry on the menu, and putting it here would make one card behave
 * unlike the others. `pits` is a shipped, reachable mode the four-card list does not mention. So the
 * list is the four real rule sets, and the daily keeps its own button.
 */
export class Modes extends Phaser.Scene {
  private topBar!: TopBar
  private navBar!: NavBar
  private pageBackground!: PageBackground
  private region!: ScrollableCameraRegion
  private scrollState!: ScrollMomentumState
  private scrollY = 0
  private maxScroll = 0
  private dragging = false
  private dragOrigin = 0
  private scrollOrigin = 0

  private heading!: Phaser.GameObjects.Text
  private cards: {
    id: RulesId
    plate: Phaser.GameObjects.Graphics
    icon: Phaser.GameObjects.Image
    /** `false` until this card's miniature has been baked — see {@link Modes.bakeOnePending}. */
    baked: boolean
    /** The card's top edge in list coordinates, for the visibility test. */
    top: number
    height: number
    title: Phaser.GameObjects.Text
    /** How a disc leaves the board in this mode — the one thing every card was missing. */
    win: Phaser.GameObjects.Text
    about: Phaser.GameObjects.Text
    check: Phaser.GameObjects.Text
    hit: Phaser.GameObjects.Rectangle
  }[] = []
  private listTop = 0
  private listHeight = 0
  private startButton!: GameButton

  /**
   * Drawn INSIDE the scroll region, and pinned by cancelling the region camera's own scroll.
   *
   * The obvious arrangement — bar on the main camera, so it cannot move — does not render at all: a
   * later camera's viewport does not composite over the earlier one, it OWNS those pixels, so the same
   * `Graphics` draws normally above the region's band and is erased inside it. See "Scroll Patterns".
   */
  private scrollbar!: Phaser.GameObjects.Graphics
  /** Where it sits, in screen px. Written by `layout()`, read by `drawScrollbar()` — which is also
   * called from the drag handler and from `update()`, neither of which knows the layout. */
  private scrollbarTrack = { x: 0, width: 0, height: 0 }

  private chosen!: RulesId
  /** One press only while the popup is on its way up — `bindAction` fires on POINTER_DOWN, and
   * launching the same overlay twice in one gesture leaves a scene paused with nothing over it. */
  private leaving = false

  constructor() {
    super('Modes')
  }

  create() {
    this.cards = []
    this.scrollY = 0
    this.dragging = false
    this.scrollState = createScrollMomentumState()
    this.chosen = currentRulesId()
    this.leaving = false

    this.pageBackground = createPageBackground(this)

    this.topBar = createTopBar(this, { back: true, onBack: () => navBack(this), onSettings: () => this.openSettings() })
    this.topBar.setCoins(coinBalance())
    this.navBar = createNavBar(this, 'Modes')

    this.heading = this.add.text(0, 0, t('modes'), { fontFamily: getDisplayFontStack(), fontSize: SECTION_FONT_SIZE, color: MUTED_COLOR }).setOrigin(0, 0.5)

    for (const set of ALL_RULE_SETS) {
      const plate = this.add.graphics()
      // Deliberately textureless at creation. Baking all six here costs ~94ms on a desktop
      // (measured: ~15.6ms each), which is a visible stall on entry and would be several times
      // that on a phone. See `bakeOnePending`.
      const icon = this.add.image(0, 0, '__MISSING').setOrigin(0, 0.5).setVisible(false)
      const title = this.add.text(0, 0, t(nameKey(set.id)), { fontFamily: getDisplayFontStack(), fontSize: TITLE_FONT_SIZE, color: LABEL_COLOR }).setOrigin(0, 0)
      const about = this.add
        .text(0, 0, t(aboutKey(set.id)), { fontFamily: 'Arial', fontSize: ABOUT_FONT_SIZE, color: MUTED_COLOR, wordWrap: { width: 200 } })
        .setOrigin(0, 0)
      const win = this.add
        .text(0, 0, t(winKey(set.id)), { fontFamily: 'Arial', fontSize: ABOUT_FONT_SIZE, color: WIN_COLOR, wordWrap: { width: 200 } })
        .setOrigin(0, 0)
      const check = this.add.text(0, 0, '✓', { fontFamily: 'Arial', fontSize: 22, color: CHECK_COLOR }).setOrigin(1, 0.5)
      const hit = this.add.rectangle(0, 0, 100, CARD_MIN_HEIGHT, 0x000000, 0).setInteractive({ useHandCursor: true })
      bindAction(this, `chooseMode:${set.id}`, { pointer: hit }, () => this.choose(set.id))
      this.cards.push({ id: set.id, plate, icon, baked: false, top: 0, height: 0, title, win, about, check, hit })
    }

    // **The screen that explains the modes is also the screen that acts on one.** Without this it
    // could only remember a preference, so choosing a mode meant going back to the menu to act on
    // it — and `MainMenu`'s New match, which arrives here, would have had nowhere to arrive AT.
    //
    // It is the one primary action on the screen (`ui/button.ts`'s one-gold rule) and, since the
    // cards stopped opening anything, the ONLY one: the cards are choices and this is the act. That
    // separation is why a player can read all four modes without a dialog appearing at the first one
    // they touch.
    this.startButton = gameButton(this, { size: 'primary', variant: 'gold', label: t('startMatch') })
    bindAction(this, 'startMatch', { pointer: this.startButton.hitArea, keys: ['ENTER', 'SPACE'] }, () => this.askRival())


    // The list clips through a dedicated camera's VIEWPORT. `setMask()` with a GeometryMask is a
    // silent no-op under WebGL in this Phaser build (CLAUDE.md "Scroll Patterns") — content would
    // simply escape the region and draw over the bars.
    this.region = scrollableCameraRegion(this, { x: 0, y: 0, width: 1, height: 1 })
    this.scrollbar = this.add.graphics()
    this.bindScroll()

    bindLayout(this, (width, height) => this.layout(width, height))
    this.refresh()
  }

  private openSettings(): void {
    this.scene.pause()
    this.scene.launch('Settings', { opener: 'Modes' })
  }

  /**
   * Drag-to-scroll on the list.
   *
   * Samples are pushed with the POINTER EVENT's own timestamp rather than a scene clock: several
   * raw moves can land inside one `update()` tick, and sharing a timestamp between them corrupts
   * the release velocity in a way that depends on how the render rate happens to line up with the
   * input rate (see `ui/scrollMomentum.ts`'s own regression test).
   */
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
    this.bakeOnePending()
    if (this.dragging || this.scrollState.velocity === 0) return
    this.scrollY = stepMomentum(this.scrollState, this.scrollY, delta, 0, this.maxScroll, time)
    this.region.camera.setScroll(0, this.scrollY)
    this.drawScrollbar()
  }

  /**
   * Bakes at most ONE card miniature per frame, and only for a card that is on screen.
   *
   * Measured cost of the six: **~94ms cold on a desktop, ~15.6ms each**, against ~0.1ms once
   * cached, and 96 KiB of texture for the set. The memory is nothing; the 94ms is a visible hitch
   * when the scene opens, and several times worse on a phone — which is the whole reason this is
   * not a loop in `create()`.
   *
   * One per frame rather than all-visible-at-once for a specific reason: with six cards nearly all
   * of them ARE visible on entry, so filtering by visibility alone would still bake five in one
   * frame and save almost nothing. Spreading them means the scene appears immediately and the
   * miniatures arrive over the next few frames — which is what "lazy" has to mean for a list this
   * short. Visibility still matters for a longer catalogue, and both rules are cheap to keep.
   */
  private bakeOnePending(): void {
    // A lookahead of one card, so scrolling reveals a miniature that is already there rather than
    // one that starts baking as it appears.
    const from = this.scrollY - this.listHeight * 0.25
    const to = this.scrollY + this.listHeight * 1.25

    for (const card of this.cards) {
      if (card.baked) continue
      if (card.top + card.height < from || card.top > to) continue
      card.icon.setTexture(ensureModeIcon(this, card.id))
      card.icon.setDisplaySize(MODE_ICON_SIZE * uiScale(this.scale.width), MODE_ICON_SIZE * uiScale(this.scale.width))
      card.icon.setVisible(true)
      card.baked = true
      return
    }
  }

  /** Picking a mode IS the step forward: it records the choice, redraws the card, and raises step
   * two over it. A card that only ticked itself would leave the player looking for what to press
   * next, which is the state this screen was in before the split. */
  /**
   * Selects a rule set and stops there.
   *
   * **Tapping a card used to open the next step**, and that was wrong twice: a card is a CHOICE and
   * the button is the ACTION, so a choice that also acts leaves no way to change your mind by
   * looking — and a player comparing two modes had a dialog thrown at them on the way past the
   * first. Picking is now free, and the screen only moves when the player says so.
   */
  private choose(id: RulesId): void {
    this.chosen = id
    rememberRuleSet(id)
    this.refresh()
  }

  /**
   * Step one and a half: a character, or the person next to you.
   *
   * **Tapping a mode used to open the cast directly**, which quietly made "who" a question with one
   * possible answer — the two-player match had to be reached by a separate button that repeated the
   * mode choice underneath it. Asking here instead puts both answers at the same fork, and means the
   * rule set is chosen exactly once whichever way the match goes.
   *
   * Gold on the character, which is what most people came for; the friend is the ghost. Cancel is a
   * real button rather than only a tap outside — see `Confirm`'s own note on invisible exits.
   */
  private askRival(): void {
    if (this.leaving) return
    this.leaving = true
    this.scene.pause()
    this.scene.launch('Confirm', {
      opener: 'Modes',
      message: t('whoPlaying'),
      // **`leaving` is cleared BY the callback, not by the RESUME handler below, and that is a bug
      // fix rather than belt and braces.** Phaser QUEUES scene operations: `Confirm.close()` calls
      // `scene.resume('Modes')` and then runs this callback immediately, but the resume — and so the
      // RESUME event that clears the flag — does not happen until the manager's next pass. Both
      // branches here start by checking that same flag, so they were bailing out on a departure that
      // had already finished. The dialog closed and nothing else happened, on every pick.
      choices: [
        { label: t('vsBot'), variant: 'gold' as const, onPick: () => this.afterRival(() => this.openOpponents()) },
        { label: t('twoPlayerMode'), variant: 'ghost' as const, onPick: () => this.afterRival(() => this.startFriendMatch()) },
        { label: t('cancel'), variant: 'ghost' as const },
      ],
    })
    this.events.once(Phaser.Scenes.Events.RESUME, () => {
      this.leaving = false
    })
  }

  /**
   * Step two, as a popup over this screen.
   *
   * `scene.pause()` first, for the same reason every other overlay here does it: a running scene
   * underneath still has a live input plugin, and this one has a full-screen drag-to-scroll handler
   * on it. The popup resumes this scene itself on close — see `Opponents.close()`.
   */
  /**
   * Straight into a match with no character picked.
   *
   * `resume: false` for the same reason step two passes it: arriving through this screen means
   * starting something new, and a saved match is Continue's job on the menu. The saved match is
   * discarded by `Game` itself, which is also what stops a solo match in progress from being
   * silently handed two players.
   */
  private startFriendMatch(): void {
    if (this.leaving) return
    this.leaving = true
    this.scene.start('Game', { resume: false, twoPlayer: true })
  }

  /** Runs a pick from {@link askRival}. See the note there for why the flag has to be cleared here
   * rather than left to the RESUME that is still sitting in Phaser's queue. */
  private afterRival(go: () => void): void {
    this.leaving = false
    go()
  }

  private openOpponents(): void {
    if (this.leaving) return
    this.leaving = true
    this.scene.pause()
    this.scene.launch('Opponents', {
      opener: 'Modes',
      rules: this.chosen,
      // Never a resume: the whole point of coming through here is to start something new, and a
      // saved match is reached by Continue on the menu instead.
      onStart: () => this.scene.start('Game', { resume: false }),
    })
    // Cleared when this scene comes back, so the popup can be opened again after a Back.
    this.events.once(Phaser.Scenes.Events.RESUME, () => {
      this.leaving = false
    })
  }

  private refresh(): void {
    this.layout(this.scale.width, this.scale.height)
  }

  /** Skipped entirely when everything fits: a scrollbar that cannot move is furniture. */
  private drawScrollbar(): void {
    this.scrollbar.clear()
    if (this.maxScroll <= 0) return

    const { x, width, height } = this.scrollbarTrack
    const radius = width / 2
    // Region-camera space: the content starts at world y 0 and the camera is scrolled to `scrollY`,
    // so adding it back is what pins the bar to the viewport.
    const y = this.scrollY

    this.scrollbar.fillStyle(CARD_STROKE, SCROLLBAR_TRACK_ALPHA)
    this.scrollbar.fillRoundedRect(x, y, width, height, radius)

    // Thumb length is the visible FRACTION of the content, floored so it stays legible on a long
    // list; its travel is the remaining track, so it reaches the bottom exactly at maxScroll.
    const visible = height / (height + this.maxScroll)
    const thumb = Math.max(SCROLLBAR_MIN_THUMB, height * visible)
    const at = y + (height - thumb) * (this.scrollY / this.maxScroll)

    this.scrollbar.fillStyle(CARD_STROKE, SCROLLBAR_THUMB_ALPHA)
    this.scrollbar.fillRoundedRect(x, at, width, thumb, radius)
  }

  layout(width: number, height: number): void {
    this.pageBackground.resize(width, height)
    const scale = uiScale(width)
    const column = contentColumn(width)
    const left = (width - column) / 2

    this.topBar.layout(width, height)
    this.navBar.layout(width, height)

    const top = this.topBar.height(this)
    const bottom = this.navBar.height(this)

    // The start button is pinned to the bottom of the free space and the LIST gets whatever is left
    // — a control the player must reach should not be the thing that scrolls away, and that goes
    // double for the button that leaves the screen. Everything else now scrolls, including the cast:
    // eighteen characters and four rule sets do not fit any phone, and pinning one of the two lists
    // would mean choosing which half of the same decision is allowed to be seen.
    //
    // Height from the token rather than from `this.startButton.height`, which is still at the
    // previous scale until `layout()` runs on it further down — see `buttonHeight`'s own note.
    const startH = buttonHeight('primary', scale)
    const startTop = height - bottom - startH - 12 * scale
    const blockTop = startTop

    /**
     * **The heading is the first thing to go when the screen cannot hold a card**, and the nav bar
     * is why that is affordable: it already names this screen in a highlighted tab, so the word
     * "Modes" over the list is the one row here that says nothing new. It buys back 28px, which at
     * 740x360 is the difference between a third of a card and most of one.
     *
     * What it replaced was a `Math.max(80, ...)` floor on the list height — see
     * `listHeightBetween`, which now states the rule the three lists in this game all got wrong.
     */
    const roomy = blockTop - (top + 36 * scale) - 12 * scale >= COMFORTABLE_LIST_HEIGHT
    this.heading.setVisible(roomy)
    this.heading.setFontSize(SECTION_FONT_SIZE * scale)
    this.heading.setPosition(left, top + 18 * scale)

    const listTop = top + (roomy ? 36 : 8) * scale
    const listHeight = listHeightBetween(listTop, blockTop - 12 * scale)
    this.listTop = listTop
    this.listHeight = listHeight
    this.region.setBounds({ x: 0, y: listTop, width, height: listHeight })

    // Cards are laid out at their TRUE, unscrolled positions and the camera pans over them — the
    // whole point of a camera-viewport clip is that scrolled content is positioned once.
    const gap = CARD_GAP * scale
    let y = 0
    for (const card of this.cards) {
      const selected = card.id === this.chosen
      const pad = CARD_PADDING * scale
      const iconSize = MODE_ICON_SIZE * scale

      // **Text first, plate second.** The card's height is derived from its own copy rather than
      // fixed, because a fixed height has to be sized for the worst case and then every other card
      // carries that much dead air — and the worst case is not even in English: Spanish runs longer,
      // and the win line added a third block on top. Laying the text out before drawing the plate is
      // what makes the height knowable.
      const textLeft = left + pad + iconSize + 14 * scale
      const textWidth = column - (textLeft - left) - pad - 26 * scale
      card.title.setFontSize(TITLE_FONT_SIZE * scale)
      card.title.setPosition(textLeft, y + pad)
      // The win condition sits directly under the name and ABOVE the flavour, because it is the
      // question a player actually has in front of a mode picker.
      card.win.setFontSize(ABOUT_FONT_SIZE * scale)
      card.win.setWordWrapWidth(textWidth)
      card.win.setPosition(textLeft, y + pad + card.title.height + 4 * scale)
      card.about.setFontSize(ABOUT_FONT_SIZE * scale)
      card.about.setWordWrapWidth(textWidth)
      card.about.setPosition(textLeft, card.win.y + card.win.height + 5 * scale)

      // The floor keeps a short card from collapsing round its icon, which is taller than two lines
      // of copy on its own.
      const contentH = card.about.y + card.about.height + pad - y
      const cardH = Math.max(CARD_MIN_HEIGHT * scale, iconSize + pad * 2, contentH)

      card.plate.clear()
      card.plate.fillStyle(selected ? CARD_FILL_SELECTED : CARD_FILL, 1)
      card.plate.fillRoundedRect(left, y, column, cardH, CARD_RADIUS * scale)
      card.plate.lineStyle((selected ? 3 : 2) * scale, selected ? CARD_STROKE_SELECTED : CARD_STROKE, 1)
      card.plate.strokeRoundedRect(left, y, column, cardH, CARD_RADIUS * scale)

      if (card.baked) card.icon.setDisplaySize(iconSize, iconSize)
      card.icon.setPosition(left + pad, y + cardH / 2)

      card.check.setFontSize(22 * scale)
      card.check.setPosition(left + column - pad, y + cardH / 2)
      card.check.setVisible(selected)

      card.hit.setPosition(left + column / 2, y + cardH / 2)
      card.hit.setSize(column, cardH)
      ;(card.hit.input?.hitArea as Phaser.Geom.Rectangle | undefined)?.setTo(0, 0, column, cardH)

      card.top = y
      card.height = cardH
      y += cardH + gap
    }

    const contentHeight = Math.max(0, y - gap)
    this.maxScroll = Math.max(0, contentHeight - listHeight)
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScroll)
    this.region.camera.setScroll(0, this.scrollY)

    // Mutual ignore lists. An object in NEITHER renders in BOTH — which here would draw the card
    // list a second time over the bars, at its unscrolled position.
    const listObjects = this.cards.flatMap((c) => [c.plate, c.icon, c.title, c.win, c.about, c.check, c.hit])
    const chrome = [this.startButton.container, this.heading, ...this.topBar.objects, ...this.navBar.objects]
    this.region.camera.ignore(chrome)
    // The bar belongs to the LIST's camera, not the main one — see its own note.
    this.cameras.main.ignore([...listObjects, this.scrollbar])

    this.scrollbarTrack = { x: left + column + SCROLLBAR_GAP * scale, width: SCROLLBAR_WIDTH * scale, height: listHeight }
    this.drawScrollbar()

    this.startButton.layout(width / 2, startTop + startH / 2, scale)
  }
}

function nameKey(id: RulesId): StringKey {
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


/**
 * Which win line a mode shows.
 *
 * Three lines rather than six, because the win condition is a property of how discs LEAVE, and only
 * two things affect that: whether the rim swallows or bounces, and whether there are holes. Modes
 * that share both share a line, and writing six near-identical strings would be six chances for one
 * of them to drift.
 */
function winKey(id: RulesId): StringKey {
  const rules = getRuleSet(id)
  if (rules.bumperRim) return 'ruleWinBumper'
  return rules.pits ? 'ruleWinPits' : 'ruleWinDefault'
}

function aboutKey(id: RulesId): StringKey {
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
