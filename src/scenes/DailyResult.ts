import * as Phaser from 'phaser'
import { playSfx } from '../audio/audio'
import { SFX } from '../assets'
import { t } from '../i18n/strings'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { gameButton, type GameButton } from '../ui/button'
import { countUp } from '../ui/countUp'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { createOverlay, type Overlay } from '../ui/overlay'
import { createStatGrid, type StatGrid, type StatRow } from '../ui/statGrid'
import { uiScale } from '../ui/uiScale'
import { raiseOverlay } from '../platform/lifecycle'

/**
 * The end of a daily puzzle.
 *
 * **It did not exist, and that was the gap.** Solving §7's one-shot puzzle played `SFX.win` and
 * rewrote two lines of text in the HUD band — that was the entire celebration, on the one screen in
 * the game whose whole point is a once-a-day moment. A match gets `MatchResult`; the daily got a
 * caption in a corner. Reported from the live game as "после прохождения нет никакого окошка".
 *
 * ## Why it is a second scene rather than a third `scope` on `MatchResult`
 *
 * `MatchResult` earns its two scopes because a round and a match are the same moment with the same
 * data — a winner, a branch, discs left, a strip of rounds. A daily shares none of it: there is no
 * opponent, no branch, no round strip, no combo and no coins, and every one of `MatchResultData`'s
 * fourteen fields would have to become optional to let one through. That does not make the two
 * panels one panel; it makes one panel's contract worse for the caller that was using it properly.
 *
 * What IS shared is the kit — `ui/overlay.ts`, `ui/statGrid.ts`, `ui/countUp.ts`, `ui/button.ts` —
 * and the nine rules `MatchResult`'s header lists, which are followed here in the same order. If a
 * THIRD result panel is ever wanted, that is the point at which the shared skeleton (measure, fit,
 * stack-or-row) should come out into `ui/` rather than be copied a second time.
 *
 * ## The hero is not the same number in both outcomes
 *
 * Solved, it is the STREAK — §7's whole meta is the chain of days, and the streak is the number a
 * player would say out loud. Missed, a streak says nothing about what just happened, so the hero is
 * how many targets came off. Same move `MatchResult` makes between its round and match scopes.
 */
export interface DailyResultData {
  opener: string
  solved: boolean
  /** Targets cleared out of {@link DailyResultData.targets} — the missed panel's hero. */
  cleared: number
  targets: number
  streak: number
  best: number
  /** This solve set a new longest streak. A badge, a sound, and only ever on a solve. */
  isBestStreak: boolean
  /** Puts the puzzle back as generated. Only offered when the puzzle was NOT solved: §7's streak
   * counts solved days only, so a retry costs nothing but time — and there is nothing to retry
   * once it is done. */
  onRetry: () => void
  /** The other exit, always present. */
  onQuit: () => void
  /** Offered in place of the retry once the puzzle is solved: the daily is once a day, so "again"
   * is not available and a panel with one button is a trap (`MatchResult`'s defect 7). */
  onPlayMatch: () => void
}

const CONTENT_WIDTH = 260
const PANEL_PAD = 24
const VIEWPORT_MARGIN = 16

const TITLE_FONT_SIZE = 20
const HERO_FONT_SIZE = 52
const CAPTION_FONT_SIZE = 13
const BADGE_FONT_SIZE = 13
const BADGE_HEIGHT = 24

/** Solved and not solved, as two palettes rather than two words — known from across the room before
 * a syllable is read. The same two `MatchResult` uses, and deliberately so: this game has one
 * meaning for gold and one for violet. */
const SOLVED = { frame: 0xffc94d, hero: '#ffd873', title: '#ffc94d' }
const MISSED = { frame: 0x5a2394, hero: '#93a8d6', title: '#a892c4' }

export class DailyResult extends Phaser.Scene {
  private openerKey = ''
  private result!: DailyResultData
  private overlay!: Overlay
  private palette = SOLVED

  private title!: Phaser.GameObjects.Text
  private hero!: Phaser.GameObjects.Text
  private caption!: Phaser.GameObjects.Text
  private grid!: StatGrid
  private badge?: { plate: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }
  private primaryButton!: GameButton
  private quitButton!: GameButton

  private badgeShown = false

  constructor() {
    super('DailyResult')
  }

  create(data: DailyResultData) {
    // Above every other scene, whatever order `config.ts` registered them in — see
    // `raiseOverlay`, and the four dead buttons that came of not doing this.
    raiseOverlay(this)

    this.openerKey = data.opener
    this.result = data

    // **Phaser re-uses the scene INSTANCE, so every field a `create()` writes must be cleared by the
    // next one.** `MatchResult` shipped the bug this guards against — a retained `Graphics` from a
    // previous panel, already destroyed on SHUTDOWN, handed back to `Container.add` — and it hung the
    // game behind an overlay that never appeared. This panel is raised again on every retry.
    this.badge = undefined
    this.badgeShown = false

    this.palette = data.solved ? SOLVED : MISSED

    // Not dismissible: a stray tap must not skip the one moment the daily exists for.
    this.overlay = createOverlay(this, { dismissible: false })

    this.title = this.add
      .text(0, 0, t(data.solved ? 'dailySolved' : 'dailyMissed'), {
        fontFamily: getDisplayFontStack(),
        fontSize: TITLE_FONT_SIZE,
        color: this.palette.title,
        align: 'center',
        wordWrap: { width: CONTENT_WIDTH },
      })
      .setOrigin(0.5)

    this.hero = this.add
      .text(0, 0, '0', { fontFamily: getDisplayFontStack(), fontSize: HERO_FONT_SIZE, color: this.palette.hero })
      .setOrigin(0.5)
    this.caption = this.add
      .text(0, 0, t(data.solved ? 'dailyStreakDays' : 'dailyTargetsCleared'), {
        fontFamily: getDisplayFontStack(),
        fontSize: CAPTION_FONT_SIZE,
        color: '#a892c4',
      })
      .setOrigin(0.5)

    this.grid = createStatGrid(this, this.rows())

    this.primaryButton = gameButton(this, {
      size: 'secondary',
      variant: 'gold',
      label: t(data.solved ? 'playMatch' : 'dailyRetry'),
    })
    this.quitButton = gameButton(this, { size: 'secondary', variant: 'ghost', label: t('toMenu') })

    const primary = data.solved ? data.onPlayMatch : data.onRetry
    bindAction(this, 'dailyResultPrimary', { pointer: this.primaryButton.hitArea, keys: ['SPACE', 'ENTER'] }, () => this.close(primary))
    bindAction(this, 'dailyResultQuit', { pointer: this.quitButton.hitArea, keys: ['ESC'] }, () => this.close(data.onQuit))

    if (data.solved && data.isBestStreak) {
      const plate = this.add.graphics().setAlpha(0)
      const label = this.add
        .text(0, 0, t('dailyStreakRecord'), { fontFamily: getDisplayFontStack(), fontSize: BADGE_FONT_SIZE, color: '#241033' })
        .setOrigin(0.5)
        .setAlpha(0)
      this.badge = { plate, label }
    }

    for (const object of [
      this.title,
      this.hero,
      this.caption,
      ...this.grid.objects,
      ...(this.badge ? [this.badge.plate, this.badge.label] : []),
      this.primaryButton.container,
      this.quitButton.container,
    ]) {
      this.overlay.panel.add(object)
    }

    bindLayout(this, (width, height) => this.layout(width, height))
    this.overlay.open()
    this.reveal()
  }

  /** Built as a list, so a row with nothing to say is absent rather than a zero. */
  private rows(): StatRow[] {
    const rows: StatRow[] = []
    // On a miss the streak is not the hero, so it becomes a row — it is still what the player is
    // protecting, and a missed day is exactly when they want to know what is at stake.
    if (!this.result.solved) rows.push({ label: t('dailyStreakLabel'), value: this.result.streak })
    rows.push({ label: t('dailyBestStreak'), value: this.result.best })
    return rows
  }

  /** The numbers rise, and only then does the badge arrive — a badge that appears with the number
   * that earned it is a decoration; one that appears after it is a consequence. */
  private reveal(): void {
    countUp(this, this.hero, this.result.solved ? this.result.streak : this.result.cleared, {
      format: this.result.solved ? undefined : (n) => `${n}/${this.result.targets}`,
    })
    this.grid.animate(() => this.showBadge())
    // `countUp`'s zero path skips straight past the format, leaving a bare "0" where "0/3" belongs.
    if (!this.result.solved && this.result.cleared === 0) this.hero.setText(`0/${this.result.targets}`)
  }

  private showBadge(): void {
    if (this.badgeShown || !this.badge) return
    this.badgeShown = true
    playSfx(SFX.promote, { rate: 1.5 })
    this.tweens.add({ targets: [this.badge.plate, this.badge.label], alpha: 1, duration: 180, ease: 'Cubic.easeOut' })
  }

  layout(width: number, height: number): void {
    const base = uiScale(width)

    // Two passes, exactly as `MatchResult` does it: measure at the natural scale, and if the panel
    // will not fit the viewport shrink the WHOLE thing rather than trimming gaps — trimming changes
    // the design on precisely the screens nobody checks.
    const room = height - VIEWPORT_MARGIN * 2
    let stack = true
    let measured = this.measure(width, base, stack)
    if (measured.panelHeight > room) {
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

    this.grid.layout(0, y, box.contentWidth, scale)
    y += this.grid.height(scale)

    if (this.badge) {
      y += 10 * scale
      this.layoutBadge(y, scale)
    }

    const bottom = box.panelHeight / 2 - PANEL_PAD * scale
    if (stack) {
      this.primaryButton.layout(0, bottom - this.quitButton.height - 10 * scale - this.primaryButton.height / 2, scale)
      this.quitButton.layout(0, bottom - this.quitButton.height / 2, scale)
    } else {
      const gap = 12 * scale
      const total = this.primaryButton.width + gap + this.quitButton.width
      const row = bottom - this.primaryButton.height / 2
      this.primaryButton.layout(-total / 2 + this.primaryButton.width / 2, row, scale)
      this.quitButton.layout(total / 2 - this.quitButton.width / 2, row, scale)
    }
  }

  private measure(width: number, scale: number, stack: boolean): { panelWidth: number; panelHeight: number; contentWidth: number } {
    const available = width - VIEWPORT_MARGIN * 2 - PANEL_PAD * 2 * scale
    this.primaryButton.layout(0, 0, scale)
    this.quitButton.layout(0, 0, scale)

    const wanted = stack ? CONTENT_WIDTH * scale : this.primaryButton.width + 12 * scale + this.quitButton.width
    const contentWidth = Math.min(Math.max(wanted, CONTENT_WIDTH * scale), available)

    this.title.setFontSize(TITLE_FONT_SIZE * scale).setWordWrapWidth(contentWidth)
    this.hero.setFontSize(HERO_FONT_SIZE * scale)
    this.caption.setFontSize(CAPTION_FONT_SIZE * scale)

    let content = this.title.height + 6 * scale + this.hero.height + this.caption.height + 12 * scale
    content += this.grid.height(scale)
    if (this.badge) content += 10 * scale + BADGE_HEIGHT * scale

    const buttons = stack
      ? this.primaryButton.height + 10 * scale + this.quitButton.height
      : Math.max(this.primaryButton.height, this.quitButton.height)

    const shell = PANEL_PAD * 2 * scale + 14 * scale
    return { panelWidth: contentWidth + PANEL_PAD * 2 * scale, panelHeight: content + shell + buttons, contentWidth }
  }

  private layoutBadge(topY: number, scale: number): void {
    if (!this.badge) return
    const height = BADGE_HEIGHT * scale
    this.badge.label.setFontSize(BADGE_FONT_SIZE * scale)
    const w = this.badge.label.width + 24 * scale
    this.badge.plate.clear()
    this.badge.plate.fillStyle(this.palette.frame, 1)
    this.badge.plate.fillRoundedRect(-w / 2, topY, w, height, height / 2)
    this.badge.label.setPosition(0, topY + height / 2)
  }

  /**
   * Closes and hands control back.
   *
   * The callback runs AFTER the opener has been resumed, so a retry rebuilds the puzzle in a scene
   * that is actually running. Firing it first would reset a board inside a paused scene, which then
   * resumes into a position it never drew.
   */
  private close(then: () => void): void {
    this.overlay.close(() => {
      this.scene.stop()

      const resume = (): void => {
        this.scene.resume(this.openerKey)
        then()
      }

      if (isPlatformPaused()) {
        // Same deferred resume as every other overlay here: unpausing now would resume a scene the
        // platform still considers suspended.
        this.game.events.once(YTEvents.RESUME, resume)
        return
      }
      resume()
    })
  }
}
