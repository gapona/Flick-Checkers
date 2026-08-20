import * as Phaser from 'phaser'
import { playSfx } from '../audio/audio'
import { SFX } from '../assets'
import { t } from '../i18n/strings'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { MATCH_ROUNDS } from '../game/match'
import type { FormationId } from '../game/rules'
import { gameButton, type GameButton } from '../ui/button'
import { countUp } from '../ui/countUp'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { createOverlay, type Overlay } from '../ui/overlay'
import { createStatGrid, type StatGrid, type StatRow } from '../ui/statGrid'
import { uiScale } from '../ui/uiScale'
import type { Side } from '../sim/types'

/**
 * The end of a round, or the end of a match.
 *
 * One scene for both, because they are the same moment from the player's point of view — "that
 * phase is over, here is what it was worth, here is what happens next" — and two nearly-identical
 * screens is how the two drift apart. The layout is shared to the pixel; only what goes in the hero
 * slot and the rows differs.
 *
 * ## The nine defects it is built against
 *
 * `PROMPT-UI-CHAPAEV.md`'s chunk 10 dissects a result panel from another prototype and names every
 * mistake in it. This is the answer to each, in the same order, and they are worth keeping written
 * down because most of them are invisible until someone looks for them:
 *
 * 1. **The scene must not read through.** `createOverlay`'s scrim, at 0.72 — the board behind is
 *    the thing the result is ABOUT, and it competes with it directly.
 * 2. **The buttons live inside the panel**, in its bottom zone, 24 from the bottom edge. A button
 *    floating under the frame reads as belonging to some other layer.
 * 3. **The height is computed from the content**, never a constant. A panel with 40% empty space
 *    below its text does not read as spacious, it reads as something that failed to load.
 * 4. **One number is large and the rest are small.** The hero is the round's actual outcome —
 *    discs left, or the round score — at three times the size of anything else.
 * 5. **Labels and values are two fixed columns**, not centred lines: see `ui/statGrid.ts` for why a
 *    number gaining a digit must not move its own row.
 * 6. **A record is a moment, not a row.** It gets a badge, a sound, and it arrives after the count.
 * 7. **Two exits.** Carry on, or leave. One button is a trap.
 * 8. **Winning and losing look different before they are read** — the frame and the hero change
 *    colour, so the outcome is known from across the room.
 * 9. **The numbers count up.** {@link countUp}.
 *
 * Same `scene.launch({ opener })` pattern as every other overlay here: it pauses the scene beneath
 * and resumes it by key on close, deferring that resume if a platform pause is in force, and it is
 * listed in `platform/lifecycle.ts`'s `OVERLAY_SCENES`.
 */
export interface MatchResultData {
  opener: string
  /** `'round'` while the match continues, `'match'` when it is over. */
  scope: 'round' | 'match'
  winner: Side
  /** The branch of arms this round was fought with — named in the round title. */
  formation: FormationId
  /** The player's discs still on the board. The round's hero number: it IS the result. */
  discsLeft: number
  /** Rounds won so far, both sides, and who won each one — the match hero and its strip. */
  wins: { player: number; opponent: number }
  results: readonly Side[]
  /** This round: what the player did with it. */
  knockedOut: number
  bestCombo: number
  shots: number
  /** Coins credited for this result — `0` shows nothing rather than a zero. */
  coins: number
  /** The match total so far, which is the match panel's second number. */
  totalScore: number
  /** The winner lost no disc — §3's `cleanWin`, and a badge. */
  cleanWin: boolean
  /** True when `totalScore` beat the stored best, and when `bestCombo` beat the stored best combo. */
  isBest: boolean
  isComboBest: boolean
  /** Runs when the player asks to carry on: the next round, or a rematch. */
  onContinue: () => void
  /**
   * Present ONLY when the player has just won a whole match — and when it is, it REPLACES the
   * rematch rather than joining it as a third button.
   *
   * Winning a match is what unlocks the next rung of the ladder (`game/opponents.ts`), so the thing
   * the player wants next is almost never the same opponent again — and the panel that tells them
   * they have won is the one moment the new character is worth pointing at. It takes over the
   * primary button instead of adding one because defect 7 above wants exactly two exits: three
   * buttons in a panel whose height is computed from its content is how a 390x390 landscape ends up
   * with the strip pushed off the bottom, and a rematch is still one tap away inside the gallery
   * this opens, where the character just beaten is still listed.
   */
  onNext?: () => void
  /**
   * Two people at one board, so the panel names PLAYERS rather than telling one of them they won.
   *
   * `winner` still carries the side, and `'player'` is still player one — the sides are what the
   * round machinery knows and renaming them here would mean two vocabularies for one thing.
   */
  twoPlayer?: boolean
  /** Runs when the player asks to leave. */
  onQuit: () => void
}

/** The content column inside the panel. The panel itself is this plus a pad each side. */
const CONTENT_WIDTH = 280
const PANEL_PAD = 24
/** Clear of the viewport edge on every side, so the panel never looks stuck to it. */
const VIEWPORT_MARGIN = 16

const TITLE_FONT_SIZE = 20
const HERO_FONT_SIZE = 52
const CAPTION_FONT_SIZE = 13
const BADGE_FONT_SIZE = 13

/** Win and loss, as two palettes rather than two words. */
const WIN = { frame: 0xffc94d, hero: '#ffd873', title: '#ffc94d' }
const LOSS = { frame: 0x5a2394, hero: '#93a8d6', title: '#a892c4' }

const STRIP_MARK_W = 34
const STRIP_MARK_H = 8
const STRIP_GAP = 6
const STRIP_EMPTY_ALPHA = 0.22

const BADGE_HEIGHT = 24
const BADGE_GAP = 8

export class MatchResult extends Phaser.Scene {
  private openerKey = ''
  private result!: MatchResultData
  private overlay!: Overlay
  private palette = WIN

  private title!: Phaser.GameObjects.Text
  private hero!: Phaser.GameObjects.Text
  private caption!: Phaser.GameObjects.Text
  private strip?: Phaser.GameObjects.Graphics
  private grid!: StatGrid
  private badges: { plate: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }[] = []
  private continueButton!: GameButton
  private quitButton!: GameButton

  /** The reveal is one-shot: `layout()` can run any number of times (every resize), and re-running
   * the fade would restart it from zero on a panel the player is already reading. */
  private badgesShown = false

  constructor() {
    super('MatchResult')
  }

  create(data: MatchResultData) {
    this.openerKey = data.opener
    this.result = data

    // **Phaser re-uses the scene INSTANCE, so every field a `create()` writes has to be cleared by
    // the next `create()`.** This one is raised five times a match and it did not: `badges` still
    // held the previous panel's objects, which Phaser had already destroyed on `SHUTDOWN`, and the
    // `panel.add()` loop below then threw `Cannot read properties of undefined (reading 'sys')`
    // from inside `Container.add`. The panel never appeared, and `Game` — paused a line before
    // `launch()` — stayed paused with nothing on screen able to resume it. That is the whole of the
    // "the game freezes after a win" report: the FIRST result of a session was fine and every one
    // after it hung the game. `strip` is the same hazard (a `'round'` panel following a `'match'`
    // one would inherit a destroyed Graphics), and `badgesShown` is the same class of leak with a
    // milder symptom — badges that never fade in again.
    this.badges = []
    this.badgesShown = false
    this.strip = undefined

    const won = data.winner === 'player'
    this.palette = won ? WIN : LOSS

    // **Not dismissible.** A stray tap must not be able to skip the outcome of a round — this is the
    // one overlay in the game where a tap outside does nothing at all, and `ui/overlay.ts` carries
    // the option purely for it.
    this.overlay = createOverlay(this, { dismissible: false })

    // "You won" is addressed to somebody, and in a hot-seat match the panel is looked at by both
    // people at once — so it reports who won instead of congratulating whoever is holding it.
    const roundTitle = data.twoPlayer ? t(won ? 'p1Round' : 'p2Round') : t(won ? 'resultRoundWin' : 'resultRoundLoss')
    const matchTitle = data.twoPlayer ? t(won ? 'p1Match' : 'p2Match') : t(won ? 'resultMatchWin' : 'resultMatchLoss')
    this.title = this.add
      .text(0, 0, data.scope === 'match' ? matchTitle : `${roundTitle} · ${t(formationKey(data.formation))}`, {
        fontFamily: getDisplayFontStack(),
        fontSize: TITLE_FONT_SIZE,
        color: this.palette.title,
        align: 'center',
        wordWrap: { width: CONTENT_WIDTH },
      })
      .setOrigin(0.5)

    // The hero is the outcome itself, not a score: a round is decided by how many discs survived it,
    // and a match by how the rounds went. Both are already the number the player would say out loud.
    this.hero = this.add
      .text(0, 0, '0', { fontFamily: getDisplayFontStack(), fontSize: HERO_FONT_SIZE, color: this.palette.hero })
      .setOrigin(0.5)
    this.caption = this.add
      .text(0, 0, t(data.scope === 'match' ? 'resultRounds' : 'resultDiscsLeft'), {
        fontFamily: getDisplayFontStack(),
        fontSize: CAPTION_FONT_SIZE,
        color: '#a892c4',
      })
      .setOrigin(0.5)

    if (data.scope === 'match') this.strip = this.add.graphics()

    this.grid = createStatGrid(this, this.rows())

    const carryOn = data.onNext ?? data.onContinue
    this.continueButton = gameButton(this, {
      size: 'secondary',
      variant: 'gold',
      label: t(data.onNext ? 'nextOpponent' : data.scope === 'match' ? 'rematch' : 'nextRound'),
    })
    this.quitButton = gameButton(this, {
      size: 'secondary',
      variant: 'ghost',
      label: t(data.scope === 'match' ? 'toMenu' : 'quitMatch'),
    })
    bindAction(this, 'resultContinue', { pointer: this.continueButton.hitArea, keys: ['SPACE', 'ENTER'] }, () => this.close(carryOn))
    bindAction(this, 'resultQuit', { pointer: this.quitButton.hitArea, keys: ['ESC'] }, () => this.close(data.onQuit))

    for (const badge of this.badgeLabels()) this.badges.push(this.makeBadge(badge))

    for (const object of [
      this.title,
      this.hero,
      this.caption,
      ...(this.strip ? [this.strip] : []),
      ...this.grid.objects,
      ...this.badges.flatMap((b) => [b.plate, b.label]),
      this.continueButton.container,
      this.quitButton.container,
    ]) {
      this.overlay.panel.add(object)
    }

    bindLayout(this, (width, height) => this.layout(width, height))
    this.overlay.open()
    this.reveal()
  }

  /** The rows, built as a list so one with nothing to say is simply absent rather than a zero. */
  private rows(): StatRow[] {
    const data = this.result
    if (data.scope === 'match') {
      const rows: StatRow[] = [{ label: t('statScore'), value: data.totalScore }]
      if (data.coins > 0) rows.push({ label: t('statCoins'), value: data.coins, prefix: '+' })
      return rows
    }

    const rows: StatRow[] = [
      { label: t('statKnockedOut'), value: data.knockedOut },
      { label: t('statBestCombo'), value: data.bestCombo },
      { label: t('statShots'), value: data.shots },
    ]
    if (data.coins > 0) rows.push({ label: t('statCoins'), value: data.coins, prefix: '+' })
    return rows
  }

  /** Only what was earned. A greyed-out badge for something that did not happen is a list of things
   * the player failed to do, which is not what this screen is for. */
  private badgeLabels(): string[] {
    const badges: string[] = []
    if (this.result.scope === 'round' && this.result.cleanWin && this.result.winner === 'player') badges.push(t('badgeCleanSweep'))
    if (this.result.isComboBest) badges.push(t('badgeComboRecord'))
    if (this.result.scope === 'match' && this.result.isBest) badges.push(t('newBest'))
    return badges
  }

  private makeBadge(text: string): { plate: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text } {
    const plate = this.add.graphics().setAlpha(0)
    const label = this.add
      .text(0, 0, text, { fontFamily: getDisplayFontStack(), fontSize: BADGE_FONT_SIZE, color: '#241033' })
      .setOrigin(0.5)
      .setAlpha(0)
    return { plate, label }
  }

  /**
   * The numbers rise, and only then do the badges arrive.
   *
   * The order is the point: a badge that appears at the same instant as the number that earned it is
   * a decoration, and one that appears after it is a consequence. The record sound rides the badge
   * rather than the panel opening for the same reason — chunk 10 is explicit that it must not fire
   * when the panel opens, because then it congratulates the player for finishing a round.
   */
  private reveal(): void {
    const data = this.result
    const heroValue = data.scope === 'match' ? data.wins.player : data.discsLeft
    countUp(this, this.hero, heroValue, {
      format: data.scope === 'match' ? (n) => `${n} : ${data.wins.opponent}` : undefined,
    })
    this.grid.animate(() => this.showBadges())
    // The hero of a match panel is a ratio and `countUp`'s zero path would skip straight past the
    // format, leaving a bare "0" where "0 : 3" belongs.
    if (data.scope === 'match' && heroValue === 0) this.hero.setText(`0 : ${data.wins.opponent}`)
  }

  private showBadges(): void {
    if (this.badgesShown || this.badges.length === 0) return
    this.badgesShown = true

    if (this.result.isComboBest || this.result.isBest) playSfx(SFX.promote, { rate: 1.5 })

    this.badges.forEach((badge, index) => {
      this.tweens.add({
        targets: [badge.plate, badge.label],
        alpha: 1,
        duration: 180,
        delay: index * 90,
        ease: 'Cubic.easeOut',
      })
    })
  }

  layout(width: number, height: number): void {
    const base = uiScale(width)

    // Two passes. The first measures the panel at the natural scale; if that will not fit the
    // viewport's height the second runs at whatever fraction does. Shrinking the whole panel keeps
    // every proportion inside it — the alternative, trimming gaps until it fits, changes the design
    // on exactly the screens nobody checks.
    const room = height - VIEWPORT_MARGIN * 2
    let stack = true
    let measured = this.measure(width, base, stack)
    if (measured.panelHeight > room) {
      // No vertical room to stack: try the row, and keep it only if it actually helps.
      const asRow = this.measure(width, base, false)
      if (asRow.panelHeight < measured.panelHeight) {
        stack = false
        measured = asRow
      }
    }

    const fit = Math.min(1, room / measured.panelHeight)
    const scale = base * fit
    const box = this.measure(width, scale, stack)

    this.overlay.layout(width, height)
    this.overlay.drawPanel(box.panelWidth, box.panelHeight, scale, this.palette.frame)

    let y = -box.panelHeight / 2 + PANEL_PAD * scale

    this.title.setFontSize(TITLE_FONT_SIZE * scale).setWordWrapWidth(box.contentWidth)
    this.title.setPosition(0, y + this.title.height / 2)
    y += this.title.height + 6 * scale

    this.hero.setFontSize(HERO_FONT_SIZE * scale)
    this.hero.setPosition(0, y + this.hero.height / 2)
    y += this.hero.height

    this.caption.setFontSize(CAPTION_FONT_SIZE * scale)
    this.caption.setPosition(0, y + this.caption.height / 2)
    y += this.caption.height + 12 * scale

    if (this.strip) {
      this.drawStrip(y, scale)
      y += STRIP_MARK_H * scale + 14 * scale
    }

    this.grid.layout(0, y, box.contentWidth, scale)
    y += this.grid.height(scale)

    if (this.badges.length > 0) {
      y += 10 * scale
      this.layoutBadges(y, scale)
      y += BADGE_HEIGHT * scale
    }

    // The buttons are anchored to the BOTTOM of the panel rather than to the flow above them, so the
    // 24px gap chunk 10 asks for is exactly 24 whatever the content did.
    const bottom = box.panelHeight / 2 - PANEL_PAD * scale
    if (stack) {
      this.continueButton.layout(0, bottom - this.quitButton.height - 10 * scale - this.continueButton.height / 2, scale)
      this.quitButton.layout(0, bottom - this.quitButton.height / 2, scale)
    } else {
      const gap = 12 * scale
      const total = this.continueButton.width + gap + this.quitButton.width
      const row = bottom - this.continueButton.height / 2
      this.continueButton.layout(-total / 2 + this.continueButton.width / 2, row, scale)
      this.quitButton.layout(total / 2 - this.quitButton.width / 2, row, scale)
    }
  }

  /**
   * How tall the panel has to be, and whether the two buttons fit stacked.
   *
   * Buttons stack by default — a full-width button is a bigger target and reads as the primary
   * action of the panel. They go into a row only when there is no vertical room to stack them, which
   * on this game's target viewports means landscape on a phone. That is a decision about the
   * SPACE, so it is made here with the measurements rather than from an orientation flag.
   */
  private measure(width: number, scale: number, stack: boolean): { panelWidth: number; panelHeight: number; contentWidth: number } {
    const available = width - VIEWPORT_MARGIN * 2 - PANEL_PAD * 2 * scale
    this.continueButton.layout(0, 0, scale)
    this.quitButton.layout(0, 0, scale)

    // A row of buttons needs the panel to be as wide as both of them; that only ever happens on a
    // short viewport, which is by definition a wide one, so there is room for it.
    const wanted = stack ? CONTENT_WIDTH * scale : this.continueButton.width + 12 * scale + this.quitButton.width
    const contentWidth = Math.min(Math.max(wanted, CONTENT_WIDTH * scale), available)

    this.title.setFontSize(TITLE_FONT_SIZE * scale).setWordWrapWidth(contentWidth)
    this.hero.setFontSize(HERO_FONT_SIZE * scale)
    this.caption.setFontSize(CAPTION_FONT_SIZE * scale)

    let content = this.title.height + 6 * scale + this.hero.height + this.caption.height + 12 * scale
    if (this.strip) content += STRIP_MARK_H * scale + 14 * scale
    content += this.grid.height(scale)
    if (this.badges.length > 0) content += 10 * scale + BADGE_HEIGHT * scale

    const buttons = stack
      ? this.continueButton.height + 10 * scale + this.quitButton.height
      : Math.max(this.continueButton.height, this.quitButton.height)

    const shell = PANEL_PAD * 2 * scale + 14 * scale
    return {
      panelWidth: contentWidth + PANEL_PAD * 2 * scale,
      panelHeight: content + shell + buttons,
      contentWidth,
    }
  }

  /** Five marks, one per round, in the order they were played — so a glance says WHICH rounds went
   * which way, and the rounds are §4's branches in a fixed order. */
  private drawStrip(topY: number, scale: number): void {
    if (!this.strip) return
    const w = STRIP_MARK_W * scale
    const h = STRIP_MARK_H * scale
    const step = w + STRIP_GAP * scale
    const left = -(MATCH_ROUNDS * step - STRIP_GAP * scale) / 2

    this.strip.clear()
    for (let i = 0; i < MATCH_ROUNDS; i++) {
      const outcome = this.result.results[i]
      // An unplayed round is an empty socket, not a mark of its own — the match can end at three,
      // and inventing a symbol for "never happened" would say something about a round that did not.
      const colour = outcome === 'player' ? WIN.frame : outcome === 'opponent' ? 0x8f5ad0 : 0xffffff
      this.strip.fillStyle(colour, outcome ? 1 : STRIP_EMPTY_ALPHA)
      this.strip.fillRoundedRect(left + i * step, topY, w, h, h / 2)
    }
  }

  private layoutBadges(topY: number, scale: number): void {
    const height = BADGE_HEIGHT * scale
    const widths = this.badges.map((badge) => badge.label.width + 24 * scale)
    const total = widths.reduce((sum, w) => sum + w, 0) + BADGE_GAP * scale * (this.badges.length - 1)
    let x = -total / 2

    this.badges.forEach((badge, index) => {
      badge.label.setFontSize(BADGE_FONT_SIZE * scale)
      const w = widths[index]
      badge.plate.clear()
      badge.plate.fillStyle(this.palette.frame, 1)
      badge.plate.fillRoundedRect(x, topY, w, height, height / 2)
      badge.label.setPosition(x + w / 2, topY + height / 2)
      x += w + BADGE_GAP * scale
    })
  }

  /**
   * Closes and hands control back.
   *
   * The callback runs AFTER the opener has been resumed, so whatever it does — starting the next
   * round, leaving for the menu — happens to a scene that is actually running. Firing it first would
   * mean setting up a round inside a paused scene, which then resumes into a board it never drew.
   */
  private close(then: () => void): void {
    this.overlay.close(() => {
      this.scene.stop()

      const resume = (): void => {
        this.scene.resume(this.openerKey)
        then()
      }

      if (isPlatformPaused()) {
        // Same deferred resume as Settings.close(): unpausing now would resume a scene the platform
        // still considers suspended.
        this.game.events.once(YTEvents.RESUME, resume)
        return
      }
      resume()
    })
  }
}

function formationKey(id: FormationId): 'formationInfantry' | 'formationCavalry' | 'formationArtillery' | 'formationTanks' | 'formationPlanes' {
  switch (id) {
    case 'cavalry':
      return 'formationCavalry'
    case 'artillery':
      return 'formationArtillery'
    case 'tanks':
      return 'formationTanks'
    case 'planes':
      return 'formationPlanes'
    default:
      return 'formationInfantry'
  }
}
