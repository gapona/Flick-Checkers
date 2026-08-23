import * as Phaser from 'phaser'
import { ATLAS_FRAMES, ATLAS_KEY } from '../assets'
import { markChapterSeen, type TourChapter } from '../game/tour'
import { t, type StringKey } from '../i18n/strings'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { buttonHeight, buttonWidth, gameButton, type GameButton } from '../ui/button'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { SCRIM_ALPHA, SCRIM_COLOR } from '../ui/overlay'
import { getTheme, roundedPanel, toCssColor, type RoundedPanel } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

/** A screen-space rectangle, which is all the coach ever knows about the scene it is explaining. */
export interface CoachRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CoachStep {
  /**
   * What to cut out of the dimmed screen, in SCREEN px — or `null` for a step about the screen as a
   * whole, which dims everything and centres the card.
   *
   * A rectangle rather than a game object, and that is the whole reason this scene knows nothing
   * about menus or boards: the two things it points at today are a `gameButton`'s container and a
   * board living under a zoomed camera, and only the scene that owns each can say where it is on
   * screen.
   */
  target: CoachRect | null
  title: StringKey
  body: StringKey
}

/**
 * What a scene must implement to be toured. Read off the OPENER by key — the coach is launched over
 * a paused scene and asks it where its own controls are.
 */
export interface CoachHost {
  tourSteps(): CoachStep[]
}

export interface CoachData {
  opener: string
  chapter: TourChapter
}

const CARD_MAX_WIDTH = 380
/** How narrow the card may get to stay off a spotlight — see `layoutCard`'s shrink step. */
const CARD_MIN_WIDTH = 230
const CARD_EDGE_MARGIN = 16
const CARD_PADDING = 18
const GAP = 10
const TITLE_FONT_SIZE = 20
const BODY_FONT_SIZE = 15
const COUNTER_FONT_SIZE = 12

/** How far the spotlight ring stands off the control it is around, and how round it is. */
const RING_PAD = 8
const RING_RADIUS = 14
/** The ring breathes rather than sitting still: on a screen where everything else is frozen, a
 * static outline reads as part of the layout. */
const PULSE_MS = 900
const PULSE_SPREAD = 5

/** The hand, in design units, and where its fingertip sits inside its own frame (`assets.ts`). */
const HAND_SIZE = 56
const HAND_TIP_X = 0.43
const HAND_TIP_Y = 0.02
/** The tap: down by this much, then back. One cycle per {@link TAP_MS}. */
const TAP_TRAVEL = 9
const TAP_MS = 620

const FADE_MS = 160

/**
 * The control's rectangle, grown by the ring's standoff and kept inside the viewport.
 *
 * Both halves matter: the ring has to stand off whatever it is around, and it has to stay on the
 * screen. A rectangle that starts off screen (which nothing does today, but a HUD is a moving
 * target) collapses to zero on that axis rather than going negative, and `readSteps` has already
 * dropped anything with no size at all.
 */
function clampRect(target: CoachRect, pad: number, width: number, height: number): CoachRect {
  const left = Math.max(0, target.x - pad)
  const top = Math.max(0, target.y - pad)
  const right = Math.min(width, target.x + target.width + pad)
  const bottom = Math.min(height, target.y + target.height + pad)
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/**
 * The guided tour, as an overlay that dims a screen and points at one thing on it at a time.
 *
 * ## What it is, in one line
 *
 * A hole in a dimmed screen with a gold ring round it, a hand that taps inside the hole, and a card
 * beside it saying what that control does — `Next` walks the steps, `Skip` ends the chapter.
 *
 * ## Why this exists next to `scenes/Tutorial.ts`
 *
 * They teach different KINDS of thing. The lessons put the player on a live board and make them
 * flick a disc, which is how the gesture, the reach and the cost of losing your own disc are taught
 * and the only way they can be. Nothing on a board can say what the button in the corner does, and a
 * lesson whose goal is "press the shop" would be a lesson about pressing. So the tour names controls
 * where they are, and the lessons stay about aiming.
 *
 * ## Why the hand DEMONSTRATES rather than the player TAPPING
 *
 * The obvious design is a real hole: let the tap through, watch for the expected action, advance on
 * it. It is also the design that strands people. A tour that waits for one specific tap has to have
 * an answer for every other tap, for the player who taps nothing, and for a control that is not
 * where the tour thought it was — and its failure mode is a game that cannot be used at all. Here
 * the scene underneath is PAUSED and nothing the player does can reach it: the only two answers are
 * Next and Skip, the tour cannot be entered wrong, and what the finger does is show rather than
 * demand. The cost is that the player is told instead of taught, which for "what is this button" is
 * the right trade — the match chapter says how to shoot and then gets out of the way so it can be
 * done for real.
 *
 * ## Why it does not use `ui/overlay.ts`
 *
 * That helper animates every overlay's entrance by ZOOMING `cameras.main`, which is exactly wrong
 * here: the hole has to stay registered with a control drawn by the scene underneath, and that scene
 * is not zooming. So the scrim is hand-rolled — FOUR BANDS around the hole rather than one
 * rectangle, because Phaser's `Graphics` has no even-odd fill and a hole cut with `destination-out`
 * would need a render texture of its own. The two colours are still the helper's, so a dimmed screen
 * is the same dimmed screen wherever it comes from.
 *
 * ## Where the steps come from
 *
 * The opener, through {@link CoachHost}. This scene has no idea what a "New match" button is; it
 * gets a list of rectangles and two string keys each. That is what lets one scene tour the menu and
 * the board, and what stops it going stale when a screen is rearranged: a rectangle is asked for at
 * the moment the tour opens, so a control that moved simply moves the hole.
 *
 * Registered in `platform/lifecycle.ts`'s `OVERLAY_SCENES`, or a platform pause would freeze the two
 * buttons that are the only way out of it.
 */
export class Coach extends Phaser.Scene {
  private openerKey = 'MainMenu'
  private chapter: TourChapter = 'menu'
  private steps: CoachStep[] = []
  private index = 0

  /** Swallows every tap that is not one of this scene's own two buttons. The scene underneath is
   * paused, but this one is not, and a card that can be tapped THROUGH is not a dialog. */
  private blocker!: Phaser.GameObjects.Rectangle
  private scrim!: Phaser.GameObjects.Graphics
  private ring!: Phaser.GameObjects.Graphics
  private hand!: Phaser.GameObjects.Image
  private card!: RoundedPanel
  private title!: Phaser.GameObjects.Text
  private body!: Phaser.GameObjects.Text
  private counter!: Phaser.GameObjects.Text
  private nextButton!: GameButton
  private skipButton!: GameButton

  /** The card as `layout()` last placed it, in screen px — a panel drawn into a `Graphics` has no
   * bounds to ask for, and `tests/platform/coach.test.ts` asserts it never covers the spotlight. */
  cardRect = { x: 0, y: 0, width: 0, height: 0 }
  /** The hole as `layout()` last cut it, or `null` on a step with no target. Read by the same test. */
  holeRect: CoachRect | null = null

  /** 0..1, driven by one tween and read by `paint()` — the ring's breath. Scene state rather than a
   * tween on an object property because what it changes is a DRAWING, and the whole scrim is redrawn
   * on the same pass anyway. */
  private pulse = 0
  private finished = false
  /** Where the hand rests, before the tap tween pushes it down. Set by `layout()`. */
  private handHomeY = 0
  private handScale = 1

  constructor() {
    super('Coach')
  }

  init(data?: Partial<CoachData>): void {
    this.openerKey = data?.opener ?? 'MainMenu'
    this.chapter = data?.chapter ?? 'menu'
  }

  create(): void {
    const colors = getTheme().colors
    // Cleared explicitly: Phaser re-uses the scene INSTANCE across launches, and this one is
    // launched at least twice a save. See `MatchResult`'s header for the version of this that
    // shipped as a freeze.
    this.index = 0
    this.finished = false
    this.pulse = 0
    this.cardRect = { x: 0, y: 0, width: 0, height: 0 }
    this.holeRect = null
    this.steps = this.readSteps()

    /**
     * Nothing to say is not an error — a screen that publishes no steps simply has no tour.
     *
     * It is FILED AS SHOWN anyway, and that is not laziness: each host checks `shouldRunTour` in its
     * own `create()`, and this scene resumes the opener as it leaves. Leaving the chapter unseen here
     * would make a screen that produces no steps reopen the tour every single time it is entered.
     */
    if (this.steps.length === 0) {
      markChapterSeen(this.chapter)
      this.scene.stop()
      this.scene.resume(this.openerKey)
      return
    }

    this.blocker = this.add.rectangle(0, 0, 1, 1, 0x000000, 0).setOrigin(0.5)
    this.scrim = this.add.graphics()
    this.ring = this.add.graphics()
    this.hand = this.add
      .image(0, 0, ATLAS_KEY, ATLAS_FRAMES.hand)
      .setOrigin(HAND_TIP_X, HAND_TIP_Y)
      .setTint(colors.accent)
      .setVisible(false)

    this.card = roundedPanel(this)
    this.title = this.add
      .text(0, 0, '', { fontFamily: getDisplayFontStack(), fontSize: TITLE_FONT_SIZE, color: toCssColor(colors.accent), align: 'center' })
      .setOrigin(0.5, 0)
    this.body = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: BODY_FONT_SIZE, color: '#e6d8f5', align: 'center' }).setOrigin(0.5, 0)
    this.counter = this.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: COUNTER_FONT_SIZE, color: '#c9b6e8' }).setOrigin(0.5, 0)

    this.nextButton = gameButton(this, { size: 'compact', variant: 'gold', label: t('coachNext') })
    this.skipButton = gameButton(this, { size: 'compact', variant: 'ghost', label: t('coachSkip') })
    // ENTER and SPACE walk it, ESC leaves it: a tour is the one thing in this game a player may
    // reasonably want to get through without aiming at anything.
    bindAction(this, 'coachNext', { pointer: this.nextButton.hitArea, keys: ['ENTER', 'SPACE'] }, () => this.advance())
    bindAction(this, 'coachSkip', { pointer: this.skipButton.hitArea, keys: ['ESC'] }, () => this.finish())

    // The step's text is set BEFORE the first layout, not after it: `bindLayout` runs one layout
    // immediately, and a card sized around three empty `Text` objects is a card the body overflows.
    this.showStep()
    bindLayout(this, (width, height) => this.layout(width, height))

    // The scrim's own alpha is the product rule from `ui/overlay.ts`: the bands are drawn at full
    // alpha and the OBJECT is what fades, or the two alphas multiply to nothing.
    this.tweens.add({ targets: this.scrim, alpha: { from: 0, to: SCRIM_ALPHA }, duration: FADE_MS })
    this.tweens.add({
      targets: [this.ring, this.hand, this.card.graphics, this.title, this.body, this.counter, this.nextButton.container, this.skipButton.container],
      alpha: { from: 0, to: 1 },
      duration: FADE_MS,
    })

    // Two loops that never stop: the ring's breath and the hand's tap. Both run on scene state rather
    // than on per-step objects, so walking to the next step does not restart them mid-beat.
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: PULSE_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        this.pulse = tween.getValue() ?? 0
        this.paint()
      },
    })
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: TAP_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Quad.easeInOut',
      onUpdate: (tween) => {
        const value = tween.getValue() ?? 0
        this.hand.setY(this.handHomeY + value * TAP_TRAVEL * uiScale(this.scale.width))
        this.hand.setScale(this.handScale * (1 - value * 0.06))
      },
    })
  }

  /**
   * Asks the opener for its steps, and drops any whose target has no size.
   *
   * A control that is not on this screen right now reports a zero box rather than being absent —
   * `MainMenu`'s Continue on a fresh save, the side panel's blocks in portrait — and a spotlight
   * around nothing is a hole in the corner of the screen with a hand tapping it. That is what saves
   * every host from a branch per layout.
   */
  private readSteps(): CoachStep[] {
    const host = this.scene.get(this.openerKey) as unknown as Partial<CoachHost> | undefined
    if (!host || typeof host.tourSteps !== 'function') return []
    return host.tourSteps().filter((step) => step.target === null || (step.target.width > 1 && step.target.height > 1))
  }

  private advance(): void {
    if (this.finished) return
    if (this.index >= this.steps.length - 1) {
      this.finish()
      return
    }
    this.index += 1
    this.showStep()
    this.layout(this.scale.width, this.scale.height)
  }

  private showStep(): void {
    const step = this.steps[this.index]
    if (!step) return
    this.title.setText(t(step.title))
    this.body.setText(t(step.body))
    this.counter.setText(t('coachStep', { n: this.index + 1, total: this.steps.length }))
    this.nextButton.setLabel(this.index >= this.steps.length - 1 ? t('coachDone') : t('coachNext'))
  }

  /**
   * Ends the chapter — by finishing it or by skipping it, which are the same thing to the save.
   *
   * The chapter is filed HERE and not when it opened: a player who closes the game halfway through
   * has not been shown the screen, and counting a dialog they dismissed would mean never offering it
   * again (`game/tour.ts`).
   */
  private finish(): void {
    if (this.finished) return
    this.finished = true
    markChapterSeen(this.chapter)

    this.tweens.add({
      targets: [this.scrim, this.ring, this.hand, this.card.graphics, this.title, this.body, this.counter, this.nextButton.container, this.skipButton.container],
      alpha: 0,
      duration: FADE_MS,
      onComplete: () => {
        this.scene.stop()
        const done = () => this.scene.resume(this.openerKey)
        // Same deferral as every other overlay: resuming the opener while the platform still
        // considers the game suspended would unfreeze a scene YouTube thinks is paused.
        if (isPlatformPaused()) {
          this.game.events.once(YTEvents.RESUME, done)
          return
        }
        done()
      },
    })
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)

    this.blocker.setSize(width, height).setPosition(width / 2, height / 2)
    // Made interactive only once it has a real size: `setInteractive()` on a 0x0 object creates no
    // `.input` at all, and calling it again later merely re-enables the one it never got.
    if (!this.blocker.input) this.blocker.setInteractive()
    else (this.blocker.input.hitArea as Phaser.Geom.Rectangle).setTo(0, 0, width, height)

    this.title.setFontSize(TITLE_FONT_SIZE * scale)
    this.body.setFontSize(BODY_FONT_SIZE * scale)
    this.counter.setFontSize(COUNTER_FONT_SIZE * scale)

    const step = this.steps[this.index]
    const pad = RING_PAD * scale
    /**
     * The ring stands `RING_PAD` off the control — and is then CLAMPED to the viewport, because a
     * control can legitimately sit against an edge.
     *
     * Seen on a 375x664 phone: the two priced buttons end a few pixels above the bottom of the
     * screen, so the ring's lower half was drawn off it and the spotlight read as a broken box
     * rather than as a ring around a button. Clamping loses a line of ring on that side and keeps
     * the shape closed, which is the right trade — the hole is still exactly the control.
     */
    this.holeRect = step?.target ? clampRect(step.target, pad, width, height) : null

    this.layoutCard(width, height, scale)
    this.layoutHand(scale)
    this.paint()
  }

  /**
   * Places the card in a band the hole leaves, and never on top of it.
   *
   * FOUR candidates, not two. Below-or-above is right on a phone held upright, where a spotlit
   * control leaves half a screen above it, and simply wrong in landscape: an 844x390 window with a
   * ringed button across its middle leaves ~200 units above and ~80 below against a card taller than
   * either, so "the bigger band, clamped" draws the card over the ring it is explaining. The bands
   * BESIDE the hole are the ones with room there.
   *
   * The vertical pair is tried first and the roomier of the two first within it: a caption under the
   * thing it describes is the one every player has read before. Inside a band the card is pushed
   * AGAINST the hole rather than centred in it — half a screen of gap between a ring and its
   * explanation makes the player look for a second explanation.
   */
  private layoutCard(width: number, height: number, scale: number): void {
    const margin = CARD_EDGE_MARGIN * scale
    const pad = CARD_PADDING * scale
    const gap = GAP * scale
    const buttonH = buttonHeight('compact', scale)
    /**
     * The two answers side by side want this much, and the card is not allowed to be narrower than
     * its own buttons.
     *
     * **This is a fixed-token kit, unlike the project this scene came from**, where a button
     * auto-sizes to its label and a card is always wider than two of them. Here `compact` is 168
     * design units whatever it says, so two plus the gap and the padding want 382 against a
     * `CARD_MAX_WIDTH` of 380 — the buttons hung out over both edges of their own plate at every
     * viewport, and worse once the card narrowed to dodge a spotlight. Seen in a screenshot, not in
     * a test: `coach.test.ts` measured the CARD against the hole and never the buttons against the
     * card, which it now does.
     */
    const rowW = buttonWidth('compact', scale) * 2 + gap
    const sideBySide = rowW + pad * 2
    /** How tall the answers are, in one row or in two. */
    const answersH = (w: number) => (w >= sideBySide ? buttonH : buttonH * 2 + gap)
    /** Sizes the card to a given width and reports the height that content then needs. */
    const measure = (w: number) => {
      this.body.setWordWrapWidth(w - pad * 2, true)
      this.title.setWordWrapWidth(w - pad * 2, true)
      return pad * 2 + this.title.height + gap * 0.6 + this.body.height + gap + this.counter.height + gap + answersH(w)
    }

    // Widened to the button row where the viewport can pay for it; where it cannot, the row STACKS
    // rather than the card overflowing — a narrow phone loses a line of card, not its answers.
    let cardW = Math.min(width - margin * 2, Math.max(CARD_MAX_WIDTH * scale, sideBySide))
    let cardH = measure(cardW)

    const cx = width / 2
    let cardLeft = cx - cardW / 2
    let cardTop = (height - cardH) / 2

    const hole = this.holeRect
    if (hole) {
      const clamp = (value: number, low: number, high: number) => Phaser.Math.Clamp(value, low, Math.max(low, high))
      const holeCy = hole.y + hole.height / 2
      const below = { fits: hole.y + hole.height + gap + cardH <= height - margin, x: cx - cardW / 2, y: hole.y + hole.height + gap }
      const above = { fits: hole.y - gap - cardH >= margin, x: cx - cardW / 2, y: hole.y - gap - cardH }
      const right = {
        fits: hole.x + hole.width + gap + cardW <= width - margin,
        x: hole.x + hole.width + gap,
        y: clamp(holeCy - cardH / 2, margin, height - margin - cardH),
      }
      const left = {
        fits: hole.x - gap - cardW >= margin,
        x: hole.x - gap - cardW,
        y: clamp(holeCy - cardH / 2, margin, height - margin - cardH),
      }
      const vertical = height - (hole.y + hole.height) >= hole.y ? [below, above] : [above, below]
      const horizontal = width - (hole.x + hole.width) >= hole.x ? [right, left] : [left, right]
      let chosen = [...vertical, ...horizontal].find((candidate) => candidate.fits)

      /**
       * Nothing fits at its natural width: the card gets NARROWER rather than moving on top of the
       * ring.
       *
       * The case is a landscape match — the board takes the whole height of the viewport and leaves
       * no band above or below it, and the strip beside it is narrower than the card. Losing a few
       * units of card is a re-wrap; losing the spotlight is losing the point of the screen. Floored
       * at {@link CARD_MIN_WIDTH}, past which the text is a column two words wide.
       */
      if (!chosen) {
        const bandLeft = hole.x - margin - gap
        const bandRight = width - (hole.x + hole.width) - margin - gap
        const band = Math.max(bandLeft, bandRight)
        // The floor is whichever is larger: the readable minimum, and one stacked button plus its
        // padding. Narrower than that and the answers hang off the plate again, one row down.
        const floor = Math.max(CARD_MIN_WIDTH * scale, buttonWidth('compact', scale) + pad * 2)
        if (band >= floor) {
          cardW = Math.min(cardW, band)
          cardH = measure(cardW)
          const y = clamp(hole.y + hole.height / 2 - cardH / 2, margin, height - margin - cardH)
          chosen = bandRight >= bandLeft ? { fits: true, x: hole.x + hole.width + gap, y } : { fits: true, x: hole.x - gap - cardW, y }
        }
      }

      // And if even that is impossible — a hole covering the whole viewport, which no step produces
      // today — the roomier vertical band, clamped. `tests/platform/coach.test.ts` is what would
      // catch this becoming real.
      const placed = chosen ?? {
        x: cx - cardW / 2,
        y: clamp(vertical[0] === below ? hole.y + hole.height + gap : hole.y - gap - cardH, margin, height - margin - cardH),
      }
      cardLeft = clamp(placed.x, margin, width - margin - cardW)
      cardTop = placed.y
    }
    cardTop = Phaser.Math.Clamp(cardTop, margin, Math.max(margin, height - margin - cardH))

    const centreX = cardLeft + cardW / 2
    this.cardRect = { x: cardLeft, y: cardTop, width: cardW, height: cardH }
    this.card.draw(centreX, cardTop + cardH / 2, cardW, cardH, getTheme().colors.secondary)

    let cursor = cardTop + pad
    this.title.setPosition(centreX, cursor)
    cursor += this.title.height + gap * 0.6
    this.body.setPosition(centreX, cursor)
    cursor += this.body.height + gap
    this.counter.setPosition(centreX, cursor)
    cursor += this.counter.height + gap

    // Skip on the left, Next on the right: the answer that continues sits where a thumb expects the
    // primary, and it is the only gold thing on this screen apart from the ring. Stacked on a card
    // too narrow for both, gold on top — the same order the menu's own column uses.
    const buttonW = buttonWidth('compact', scale)
    const rowY = cursor + buttonH / 2
    if (cardW >= sideBySide) {
      this.skipButton.layout(centreX - (buttonW + gap) / 2, rowY, scale)
      this.nextButton.layout(centreX + (buttonW + gap) / 2, rowY, scale)
    } else {
      this.nextButton.layout(centreX, rowY, scale)
      this.skipButton.layout(centreX, rowY + buttonH + gap, scale)
    }
  }

  /** The fingertip lands on the hole's centre, with the hand hanging below and to the right of it —
   * where a real one would be, and where it covers least of what it is pointing at. */
  private layoutHand(scale: number): void {
    this.hand.setVisible(this.holeRect !== null)
    if (!this.holeRect) return
    this.handScale = (HAND_SIZE * scale) / this.hand.height
    this.hand.setScale(this.handScale)
    this.handHomeY = this.holeRect.y + this.holeRect.height / 2
    this.hand.setPosition(this.holeRect.x + this.holeRect.width / 2, this.handHomeY)
  }

  /**
   * Draws the dimmed screen and the ring, every frame the pulse moves.
   *
   * FOUR BANDS rather than one rectangle with a hole in it: `Graphics` has no even-odd fill rule, and
   * cutting a hole with `destination-out` needs a render texture of its own. Four `fillRect`s are
   * exact, cost nothing, and cannot drift out of register with the hole.
   */
  private paint(): void {
    const width = this.scale.width
    const height = this.scale.height
    const scale = uiScale(width)
    const colors = getTheme().colors

    this.scrim.clear()
    this.scrim.fillStyle(SCRIM_COLOR, 1)
    const hole = this.holeRect
    if (!hole) {
      this.scrim.fillRect(0, 0, width, height)
    } else {
      const right = hole.x + hole.width
      const bottom = hole.y + hole.height
      this.scrim.fillRect(0, 0, width, Math.max(0, hole.y))
      this.scrim.fillRect(0, bottom, width, Math.max(0, height - bottom))
      this.scrim.fillRect(0, Math.max(0, hole.y), Math.max(0, hole.x), Math.max(0, bottom - hole.y))
      this.scrim.fillRect(right, Math.max(0, hole.y), Math.max(0, width - right), Math.max(0, bottom - hole.y))
    }

    this.ring.clear()
    if (!hole) return
    const radius = RING_RADIUS * scale
    const breath = this.pulse * PULSE_SPREAD * scale
    // Two strokes: a hard gold edge on the hole itself, and a wider, fainter one breathing outside it
    // — the same two-stroke stand-in for a glow the rest of the kit uses, so this needs no shader and
    // looks identical under the Canvas fallback.
    this.ring.lineStyle(3 * scale, colors.accent, 0.95)
    this.ring.strokeRoundedRect(hole.x, hole.y, hole.width, hole.height, radius)
    this.ring.lineStyle(2 * scale, colors.accent, 0.35 * (1 - this.pulse))
    this.ring.strokeRoundedRect(hole.x - breath, hole.y - breath, hole.width + breath * 2, hole.height + breath * 2, radius + breath)
  }
}
