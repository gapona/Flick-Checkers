import * as Phaser from 'phaser'
import { backgroundKey, SFX } from '../assets'
import { playSfx } from '../audio/audio'
import { bandCenter, BOARD_SCREEN_MARGIN_PX, computeAimZoom, computeBoardFit, computeHudBands, hudReserve, type BoardFit, type HudBands } from '../board/layout'
import { createBoardView, type BoardView } from '../board/boardView'
import { boardSet } from '../game/skins'
import { createDiscView, type DiscView } from '../board/discView'
import { createAimView, type AimView } from '../board/aimView'
import { asCatalog, boardFor, DAILY_CATALOG_KEY, puzzleFor, type DailyRecord } from '../daily/catalog'
import { dailyConfig, dateKey, findSolution, isSolved } from '../daily/puzzle'
import { dailyStatus, recordDailySolved, type DailyStatus } from '../daily/streak'
import { activeBoardSet, activePieceSet, awardCoins, coinBalance } from '../game/wallet'
import { DAILY_REWARD } from '../game/economy'
import { advance, createStepper, resetStepper, type Stepper } from '../sim/step'
import { applyImpulse, freezeIfStalled, type Shot } from '../sim/shoot'
import { computeAim, discAt, firstContact, reachOf } from '../sim/aim'
import { createOutcome, type SimOutcome } from '../sim/outcome'
import { cloneState, isMoving, liveDiscs, type Disc, type SimConfig, type SimState } from '../sim/types'
import { BOT_LEVELS } from '../bot/levels'
import { logError } from '../platform/yt'
import { t } from '../i18n/strings'
import { bindAction, bindDrag } from '../platform/input'
import { contentColumn, createTopBar, navBack, navMarkRoot, screenInsets, type TopBar } from '../ui/chrome'
import { buttonHeight, buttonWidth, gameButton, type GameButton } from '../ui/button'
import { bindLayout } from '../ui/layout'
import { uiScale } from '../ui/uiScale'

/** How long the falling discs get to themselves before the result panel covers the board. */
const RESULT_DELAY_MS = 700

const STATUS_FONT_SIZE = 18

/**
 * The hint: how many failed attempts buy it, and what its line looks like.
 *
 * Three, not one. The first miss is information — it tells you the shot was long, or wide, or both —
 * and offering help before the player has had a chance to use it is a game that does not believe
 * they can solve it. By the third they are guessing, which is the state the hint exists for.
 */
const HINT_AFTER_ATTEMPTS = 3
/** Below the aim ray (40) so a hint can never be mistaken for the shot being made, above the discs. */
const HINT_DEPTH = 30
const HINT_COLOR = 0x6fe3ff
const HINT_ALPHA = 0.7
const HINT_WIDTH = 3
const HINT_DASH = 14
const HINT_GAP = 10
/** How far the line runs, in board cells — a fixed length, so it carries the direction and nothing
 * about the pull. Short of the board's diagonal on purpose: a line that reached the far rank would
 * end ON the targets and be the answer. */
const HINT_CELLS = 3
const BACKGROUND_OVERSCAN = 1.04
/** Matches `Game`'s. The daily is the same gesture on the same board, so it gets the same camera —
 * a pull that has room to be pulled in one mode and not in the other is two different games. */
const AIM_CAMERA_MS = 130
/** How far the status-and-hint block may be shrunk to fit its band before it stops being readable —
 * `Tutorial`'s own floor, for the same trade on the same viewports. */
const MIN_BLOCK_SHRINK = 0.7
const BOARD_SIZE = 8

/**
 * §7's daily: one board, one shot, clear it.
 *
 * A separate scene from `Game` rather than a mode inside it, because almost nothing is shared:
 * there is no opponent, no turn, no round, no match and no bot. What IS shared — the board, the disc
 * layer, the aim gesture, the solver — is shared as modules, which is the whole reason those were
 * written as modules.
 *
 * **The puzzle is not generated here.** It is looked up in a catalogue built by `npm run daily` and
 * committed, because §7's generate-and-reject loop costs about four seconds of solver time per day.
 * That work is done once, at build time, where it can also be PROVED — see `daily/puzzle.ts`.
 */
export class Daily extends Phaser.Scene {
  private board!: BoardView
  private discView!: DiscView
  private aimView!: AimView
  private background!: Phaser.GameObjects.Image
  private uiCamera!: Phaser.Cameras.Scene2D.Camera

  private sim!: SimState
  private simConfig!: SimConfig
  private stepper!: Stepper
  private shotOutcome: SimOutcome | null = null
  private aiming: Disc | null = null

  private record!: DailyRecord
  private today = ''
  /** The one shot has been taken and resolved. */
  private done = false
  private solved = false
  /** Kept so a failed attempt can put the board back exactly as it was — the puzzle is one shot, and
   * a retry has to be the SAME puzzle rather than a slightly nudged one. */
  private pristine!: SimState

  /**
   * How many shots this player has spent on today's puzzle, and the hint that appears once they
   * have spent enough of them.
   *
   * **Asked for by a player, in the right words**: "может оно как в сапере давало бы советы как это
   * решить?" — after taking, by their own account, a great many attempts. A one-shot puzzle with an
   * unlimited retry is not one shot in practice; it is a search, and a search with no feedback
   * between attempts is flailing rather than solving.
   *
   * **The hint shows the DIRECTION and not the power**, which is the whole of the design. §8's rule
   * for the shop — nothing may answer "can you aim this" — is about things you BUY, and this is
   * free; but the spirit of it is what stops this from being a Solve button. A line from the disc
   * says which of the 360 degrees is worth trying and leaves the pull, which is the half a player
   * actually gets better at. Minesweeper's own hint does the same thing: it removes a guess, not the
   * game.
   *
   * Session state, deliberately not saved. It resets when the screen is left, because a player who
   * comes back tomorrow is not owed yesterday's frustration, and one who leaves and returns today
   * has had the break that usually solves it anyway.
   */
  private attempts = 0
  /** The solving shot, found once and kept — see `showHint`. `null` until asked for. */
  private hint: Shot | null = null
  private hintLine!: Phaser.GameObjects.Graphics
  private hintButton!: GameButton

  /**
   * **The way out, and it is a fix rather than a tidy-up.**
   *
   * This screen used to carry a bare gear glyph and nothing else: the only exit was the `BACKSPACE`
   * key, which a phone does not have. Solving the puzzle then made it worse - `beginAim` refuses
   * once `done` is set and the retry is gated on NOT having solved it, so a player who cleared the
   * board was left on a screen where every tap did nothing at all. "It freezes after you win" was
   * exactly right. The shared bar brings a back button, the 44px floor on both icons, and the same
   * coin readout every other screen wears.
   */
  private topBar!: TopBar
  private statusText!: Phaser.GameObjects.Text

  private viewportW = 0
  private viewportH = 0
  private fit!: BoardFit
  private bands!: HudBands
  /**
   * Where the world camera points, tracked here rather than read back off it.
   *
   * `Camera.midPoint` is only refreshed during preRender, like `worldView`, so asking for it at the
   * instant a gesture starts hands back the previous frame's value.
   */
  private focus = { x: 0, y: 0 }
  private cameraTween?: Phaser.Tweens.Tween

  /**
   * The zoom the camera is heading FOR, which is not the zoom it currently has.
   *
   * **The difference is a shipped bug: "I swiped with a finger and the board shrank."** The two
   * aim-camera moves are tweens, and a tween applies nothing at the moment it is created — it writes
   * its first value on the next update. `leaveAimCamera` asked `cameras.main.zoom === fit.zoom`, so
   * when a press and a second finger landed in the SAME input tick the sequence was: press starts
   * the zoom-out tween (camera still at the resting zoom), second finger cancels the gesture,
   * `leaveAimCamera` reads a camera that has not moved yet, concludes there is nothing to undo and
   * returns — leaving the zoom-out tween running with nobody to reverse it. The board stayed small
   * for the rest of the round. Comparing against the INTENT rather than against the current frame's
   * value is what makes the guard mean what it says.
   */
  private cameraTargetZoom = 0

  constructor() {
    super('Daily')
  }

  create() {
    this.today = dateKey(new Date())

    const catalog = asCatalog(this.cache.json.get(DAILY_CATALOG_KEY))
    if (!catalog) {
      // A build that shipped without `npm run daily` having been run. Nothing here can recover, and
      // silently showing an empty board would be worse than going back to the menu.
      console.error('[daily] no puzzle catalogue in the bundle — run `npm run daily`')
      logError()
      this.scene.start('MainMenu')
      return
    }

    this.record = puzzleFor(catalog, this.today)

    this.background = this.add.image(0, 0, backgroundKey(boardSet(activeBoardSet()).background)).setOrigin(0.5).setDepth(-1000)
    this.board = createBoardView(this, BOARD_SIZE, { pits: [] }, activeBoardSet())
    // Plain board, no hazards and no bumpers: a daily is a test of one shot, and a modifier would
    // make it a test of a mode instead.
    this.simConfig = dailyConfig(this.board.metrics)
    this.stepper = createStepper()
    this.discView = createDiscView(this, () => this.syncCameraMembership(), { pieces: activePieceSet() })
    this.aimView = createAimView(this)

    this.statusText = this.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: STATUS_FONT_SIZE, color: '#ffffff', align: 'center' })
      .setOrigin(0.5, 0)
      .setShadow(0, 2, 'rgba(0,0,0,0.8)', 4)
    this.topBar = createTopBar(this, {
      back: true,
      onBack: () => navBack(this),
      onSettings: () => {
        playSfx(SFX.ui)
        this.scene.pause()
        this.scene.launch('Settings', { opener: 'Daily' })
      },
    })
    this.topBar.setCoins(coinBalance())

    /**
     * The hint's line and its button.
     *
     * The line is a WORLD object — it points from a disc at a place on the board, so it has to be
     * drawn in the board's own space and at the board's own scale. The button is UI. That split is
     * why they are handed to opposite camera ignore lists below.
     */
    this.hintLine = this.add.graphics().setDepth(HINT_DEPTH)
    this.hintButton = gameButton(this, { size: 'compact', variant: 'plum', label: t('dailyHint') })
    bindAction(this, 'dailyHint', { pointer: this.hintButton.hitArea, keys: ['H'] }, () => this.showHint())

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    for (const object of [this.statusText, this.hintButton.container, ...this.topBar.objects]) {
      this.cameras.main.ignore(object)
    }

    bindDrag(this, 'aimDaily', this.board.hitTarget, {
      onStart: (pointer) => this.beginAim(pointer),
      onMove: (pointer) => this.updateAim(pointer),
      onEnd: (pointer) => this.releaseAim(pointer),
      onCancel: () => this.cancelAim(),
    })
    // One shot means a retry has to be offered, or a puzzle you got wrong is a day you cannot play.
    // §7's streak only ever counts SOLVED days, so retrying costs nothing but time.
    bindAction(this, 'retryDaily', { pointer: this.board.hitTarget, keys: ['SPACE'] }, () => {
      if (this.done && !this.solved) this.reset()
    })
    bindAction(this, 'leaveDaily', { keys: ['BACKSPACE'] }, () => this.scene.start('MainMenu'))

    bindLayout(this, (width, height) => this.layout(width, height))
    this.reset()
  }

  /** Puts the puzzle back exactly as generated. */
  private reset(): void {
    this.pristine = boardFor(this.record, this.board.metrics)
    this.sim = cloneState(this.pristine)
    this.shotOutcome = null
    this.aiming = null
    this.done = false
    this.solved = false
    resetStepper(this.stepper)
    this.aimView.hide()
    this.discView.reset(this.sim)
    this.syncCameraMembership()
    this.refreshStatus()
    this.refreshHintButton()
    // The board is back to `pristine`, so a hint already asked for is still true — redrawn against
    // the restored discs rather than cleared, or asking for it would cost another three misses.
    this.drawHint()
  }

  private syncCameraMembership(): void {
    this.uiCamera.ignore([this.background, this.hintLine, ...this.board.worldObjects, ...this.discView.worldObjects, ...this.aimView.worldObjects])
  }

  private worldPoint(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    return this.cameras.main.getWorldPoint(pointer.x, pointer.y)
  }

  /**
   * Pulls the camera back so the slingshot has somewhere to be pulled TO.
   *
   * Ported from `Game`, and why it was missing is worth writing down: the daily is a separate scene
   * because almost nothing is shared with a match — no opponent, no turn, no round, no bot — and
   * the aim camera got filed with the match machinery it sat next to rather than with the GESTURE
   * it belongs to. It is not a match feature. The board binds to the viewport's shorter side with
   * an 8px margin, so on that axis there is no room outside the rim and a pull needs 2.5 cells of
   * it; without this a disc on the rim reaches full power pulling one way and about a quarter of it
   * pulling the other, which is the same drag meaning two different shots. On a ONE-SHOT puzzle
   * that is the whole game.
   *
   * Zoomed about the board's CENTRE rather than about the pressed disc: pinning the disc under the
   * finger looks like the considerate thing to do and destroys the apron, because if the disc does
   * not move the gap between it and the screen edge does not grow either.
   */
  private enterAimCamera(): void {
    const target = computeAimZoom(this.board.metrics, this.viewportW, this.viewportH)
    if (target >= this.fit.zoom) return
    const { boardW, boardH } = this.board.metrics
    this.moveCamera(target, boardW / 2, boardH / 2)
  }

  /** Back to the resting fit, from every ending the gesture has — fired, cancelled or interrupted.
   * A camera left zoomed out is a board that never comes back. */
  private leaveAimCamera(): void {
    const { boardW, boardH } = this.board.metrics
    if (this.cameraTargetZoom === this.fit.zoom) return
    this.moveCamera(this.fit.zoom, boardW / 2, boardH / 2)
  }

  /** Eases the world camera, writing {@link focus} from the same code that moves it so the two
   * cannot drift apart. */
  private moveCamera(zoom: number, focusX: number, focusY: number): void {
    const camera = this.cameras.main
    this.cameraTween?.stop()
    this.cameraTargetZoom = zoom

    const from = { zoom: camera.zoom, x: this.focus.x, y: this.focus.y }
    const step = { t: 0 }
    this.cameraTween = this.tweens.add({
      targets: step,
      t: 1,
      duration: AIM_CAMERA_MS,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        this.setCamera(
          from.zoom + (zoom - from.zoom) * step.t,
          from.x + (focusX - from.x) * step.t,
          from.y + (focusY - from.y) * step.t,
        )
      },
    })
  }

  /** The one place the world camera's zoom and focus are written. */
  private setCamera(zoom: number, focusX: number, focusY: number): void {
    this.focus.x = focusX
    this.focus.y = focusY
    this.cameras.main.setZoom(zoom)
    this.cameras.main.centerOn(focusX, focusY)
  }

  private beginAim(pointer: Phaser.Input.Pointer): boolean {
    if (this.done || isMoving(this.sim)) return false
    const world = this.worldPoint(pointer)
    const disc = discAt(this.sim, world.x, world.y, 'player')
    if (!disc) return false

    this.aiming = disc
    this.enterAimCamera()
    this.paintAim(world.x, world.y)
    return true
  }

  private updateAim(pointer: Phaser.Input.Pointer): void {
    if (!this.aiming) return
    const world = this.worldPoint(pointer)
    this.paintAim(world.x, world.y)
  }

  private releaseAim(pointer: Phaser.Input.Pointer): void {
    const shooter = this.aiming
    this.aiming = null
    this.aimView.hide()
    // Before the early return, not after it: a release that turns out to be a cancelled aim is
    // still the end of the gesture, and skipping it there is how a camera gets left pulled back.
    this.leaveAimCamera()
    if (!shooter) return

    const world = this.worldPoint(pointer)
    const aim = computeAim(shooter, world.x, world.y)
    if (aim.cancelled) return

    resetStepper(this.stepper)
    this.shotOutcome = createOutcome(shooter.id, shooter.side)
    applyImpulse(shooter, aim.angle, aim.power, this.simConfig.maxSpeed, this.simConfig.powerCurve)
    playSfx(SFX.move, { rate: 0.94 + aim.power * 0.16 })
  }

  private cancelAim(): void {
    this.aiming = null
    this.aimView.hide()
    this.leaveAimCamera()
  }

  private paintAim(pointerX: number, pointerY: number): void {
    const shooter = this.aiming
    if (!shooter) return

    const aim = computeAim(shooter, pointerX, pointerY)
    const contact = firstContact(this.sim, shooter, aim.angle, this.simConfig)
    const reach = reachOf(aim.power, this.simConfig, shooter)
    const reaches = contact.distance <= reach
    const distance = Math.min(contact.distance, reach)
    const target = reaches && contact.discId !== null ? this.sim.discs.find((disc) => disc.id === contact.discId) : undefined

    this.aimView.show({
      x: shooter.x,
      y: shooter.y,
      r: shooter.r,
      pointerX,
      pointerY,
      angle: aim.angle,
      power: aim.power,
      cancelled: aim.cancelled,
      endX: shooter.x + Math.cos(aim.angle) * distance,
      endY: shooter.y + Math.sin(aim.angle) * distance,
      target: target ? { x: target.x, y: target.y, r: target.r } : null,
    })
  }

  update(_time: number, delta: number): void {
    if (isMoving(this.sim)) {
      advance(this.stepper, this.sim, this.simConfig, delta / 1000, this.shotOutcome ?? undefined)
      this.discView.draw(this.sim, this.stepper.alpha)

      if (this.shotOutcome && freezeIfStalled(this.sim, this.simConfig, this.shotOutcome)) {
        console.error('[sim] a daily shot ran past the time ceiling and was frozen', this.shotOutcome)
        logError()
      }
      return
    }

    resetStepper(this.stepper)
    this.discView.draw(this.sim, 1)
    if (this.shotOutcome) this.settle()
  }

  /** The one shot has come to rest: solved, or not. */
  private settle(): void {
    this.shotOutcome = null
    this.done = true
    this.solved = isSolved(this.sim)
    // Counted on the shot that RESOLVED, not on the one that was fired: a shot still in the air has
    // not failed yet, and offering help while the discs are moving would be the game calling it early.
    this.attempts += 1
    this.refreshHintButton()

    // Read BEFORE recording: `recordDailySolved` folds the new streak into `best` itself, so asking
    // afterwards whether this was a record can only ever answer yes.
    const bestBefore = dailyStatus(this.today).best
    let status = dailyStatus(this.today)

    if (this.solved) {
      playSfx(SFX.win)
      status = recordDailySolved(this.today)
      awardCoins(DAILY_REWARD)
      this.topBar.setCoins(coinBalance())
      if (import.meta.env.DEV) console.debug(`[daily] solved ${this.today}, streak ${status.streak} (best ${status.best})`)
    } else {
      playSfx(SFX.lose)
    }

    this.refreshStatus()
    this.time.delayedCall(RESULT_DELAY_MS, () => this.showResult(status, bestBefore))
  }

  /**
   * The result panel — and until it existed, solving the puzzle produced a sound and two lines of
   * text in the corner of the HUD, on the one screen in this game built around a once-a-day moment.
   * See `scenes/DailyResult.ts` for why it is its own scene rather than a third scope on
   * `MatchResult`.
   *
   * Raised on a delay rather than the instant the solver rests: `settle()` fires when the SIM is at
   * rest, and a disc leaving the board is still visibly falling for a moment after that (the fall is
   * a view-side tween thrown with the disc's last velocity — see `board/discView.ts`). Covering that
   * with a panel would hide the very thing the shot was for.
   */
  private showResult(status: DailyStatus, bestBefore: number): void {
    const targets = this.record.discs.filter((disc) => disc.side === 'opponent').length
    const left = liveDiscs(this.sim, 'opponent').length

    this.scene.pause()
    this.scene.launch('DailyResult', {
      opener: 'Daily',
      solved: this.solved,
      cleared: targets - left,
      targets,
      streak: status.streak,
      best: status.best,
      isBestStreak: this.solved && status.best > bestBefore,
      onRetry: () => this.reset(),
      onQuit: () => this.scene.start('MainMenu'),
      // `navMarkRoot` first, deliberately: `Modes`' back button pops the nav stack, and the daily
      // was entered without pushing anything onto it, so whatever is on there belongs to an earlier
      // trip through the menus. Clearing it sends that back button to `NAV_ROOT` — the menu — rather
      // than to a puzzle the player has already finished.
      onPlayMatch: () => {
        navMarkRoot(this)
        this.scene.start('Modes')
      },
    })
  }

  /**
   * Draws the direction of a solving shot, from the disc, and never its power.
   *
   * The line runs a fixed distance rather than to where the shot actually stops: how FAR it goes is
   * the pull, which is the half the player is meant to find. A line ending on the target cluster
   * would be the answer rather than a hint.
   *
   * Solved lazily and kept. `findSolution` walks the generator's own candidate list and stops at the
   * first shot that clears the board — a few dozen `runToRest` calls for a puzzle that solves on a
   * few percent of its candidates, i.e. milliseconds. Kept because the board is put back to
   * `pristine` on every retry, so the answer does not change and re-deriving it would be work done
   * again for the same result.
   */
  private showHint(): void {
    if (this.solved) return
    if (!this.hint) this.hint = findSolution(this.pristine, this.simConfig, BOT_LEVELS.hard)
    if (!this.hint) {
      // Cannot happen for a shipped day — every one in the catalogue was proved solvable by this same
      // search. It is handled rather than asserted because the alternative is a button that throws.
      this.hintButton.setEnabled(false)
      return
    }
    playSfx(SFX.ui)
    this.drawHint()
  }

  private drawHint(): void {
    this.hintLine.clear()
    const shot = this.hint
    if (!shot || this.solved) return
    const disc = this.sim.discs.find((candidate) => candidate.id === shot.discId && candidate.alive)
    if (!disc) return

    // A fixed reach, in CELLS, so the line says the same thing on every board size and says nothing
    // at all about how hard to pull.
    const length = this.board.metrics.tile * HINT_CELLS
    const toX = disc.x + Math.cos(shot.angle) * length
    const toY = disc.y + Math.sin(shot.angle) * length

    this.hintLine.lineStyle(HINT_WIDTH, HINT_COLOR, HINT_ALPHA)
    const step = HINT_DASH + HINT_GAP
    for (let at = 0; at < length; at += step) {
      const end = Math.min(at + HINT_DASH, length)
      this.hintLine.lineBetween(
        disc.x + Math.cos(shot.angle) * at,
        disc.y + Math.sin(shot.angle) * at,
        disc.x + Math.cos(shot.angle) * end,
        disc.y + Math.sin(shot.angle) * end,
      )
    }
    // A ring on the disc it is a hint ABOUT — with one disc today that is redundant, and it stops
    // being redundant the moment a puzzle ships with two.
    this.hintLine.strokeCircle(disc.x, disc.y, disc.r + 5)
    this.hintLine.lineBetween(toX, toY, toX, toY)
  }

  /** The button appears once the player has missed enough times to be guessing — see
   * {@link HINT_AFTER_ATTEMPTS} — and never on a day already solved. */
  private refreshHintButton(): void {
    const offer = this.attempts >= HINT_AFTER_ATTEMPTS && !this.solved && !dailyStatus(this.today).solvedToday
    this.hintButton.container.setVisible(offer)
    this.hintButton.setEnabled(offer)
  }

  /**
   * What the band says — and then the band laid out AROUND it.
   *
   * **The re-layout is the fix for a shipped overlap, not a precaution.** The hint button's y is
   * `top + statusText.height + gap`, and `bindLayout` runs its first pass from `create()`, where
   * this text is still EMPTY — `reset()` is the line after it. So the button was placed against the
   * height of an empty `Text` and drawn straight through the second line of the status, on every
   * phone that is never resized after boot. Reported with a screenshot of the hint button sitting
   * across "Clear the board in one shot".
   *
   * Same defect as `Game`'s status capsule drawn around the PREVIOUS status, and the same rule: a
   * block measured from its own text has to be re-measured when the text changes.
   */
  private refreshStatus(): void {
    const status = dailyStatus(this.today)
    const lines =
      this.done && this.solved
        ? [t('dailySolved'), t('dailyStreak', { n: status.streak })]
        : this.done
          ? [t('dailyMissed'), t('tapToPlayAgain')]
          : status.solvedToday
            ? [t('dailyAlreadyDone'), t('dailyStreak', { n: status.streak })]
            : [t('dailyTitle'), t('dailyGoal')]

    this.statusText.setText(lines.join('\n'))
    this.layout(this.scale.width, this.scale.height)
  }

  private applyCamera(): void {
    const { boardW, boardH } = this.board.metrics
    // A resize DURING an aim re-enters here. Snapping to the resting fit would yank the apron out
    // from under a drag still being made, so the aim's own zoom is re-applied instead — and
    // instantly, because a resize is not an animation.
    const zoom = this.aiming ? computeAimZoom(this.board.metrics, this.viewportW, this.viewportH) : this.fit.zoom
    this.cameraTween?.stop()
    // The instant path writes the intent too — otherwise a resize mid-gesture would leave
    // `cameraTargetZoom` describing a move that no longer happened. See its own comment.
    this.cameraTargetZoom = zoom
    this.setCamera(zoom, boardW / 2, boardH / 2)

    // Sized on the RESTING fit: the press that starts a gesture always happens at that zoom, and
    // once `bindDrag` owns the pointer its moves come from the scene rather than from this zone.
    const visibleW = this.viewportW / this.fit.zoom
    const visibleH = this.viewportH / this.fit.zoom
    this.board.coverWorldView(new Phaser.Geom.Rectangle(boardW / 2 - visibleW / 2, boardH / 2 - visibleH / 2, visibleW, visibleH))

    // **Sized on the AIM zoom, not the resting fit.** The plate is a world-space object, so the
    // camera scales it too — and the aim zooms OUT, which means the world rectangle on screen is at
    // its LARGEST exactly while a gesture is being made. Covering the largest case over-covers the
    // smallest for free; the other way round, starting to aim makes the background visibly end.
    const widestZoom = Math.min(this.fit.zoom, computeAimZoom(this.board.metrics, this.viewportW, this.viewportH))
    const coverW = this.viewportW / widestZoom
    const coverH = this.viewportH / widestZoom
    const cover = Math.max(coverW / this.background.width, coverH / this.background.height) * BACKGROUND_OVERSCAN
    this.background.setPosition(boardW / 2, boardH / 2).setScale(cover)
  }

  layout(width: number, height: number): void {
    this.viewportW = width
    this.viewportH = height
    // Same reserve as `Game`: the board must not eat the band this screen's own status and hint
    // button live in. See `board/layout.ts`'s `hudReserve`.
    this.fit = computeBoardFit(this.board.metrics, width, height, BOARD_SCREEN_MARGIN_PX, hudReserve(width, height, uiScale(width), 'bands'))
    this.bands = computeHudBands(width, height, this.fit.boardPx)
    this.applyCamera()
    this.uiCamera.setViewport(0, 0, width, height)

    const scale = uiScale(width)

    this.topBar.layout(width, height)

    /**
     * The status and, under it, the hint button — as ONE block centred in the band, so the status does
     * not jump when the button appears three attempts in.
     *
     * Reserved rather than measured, the same rule the board's own speech row keeps: the button's row
     * is always part of the block's height, whether or not the button is currently in it.
     *
     * **Fitted to the band's WIDTH, which in landscape is a side strip rather than the screen.** The
     * status was never wrapped and the button is a fixed 168-unit token, so on a squarish landscape —
     * where the strip is about 160px — the two lines ran off the right of the viewport and the button
     * with them. Measured at 604x455 before this: the status ended at x=604 exactly, on a 604-wide
     * screen. `Game`'s own capsule learned the same lesson one screen along, and for the same reason:
     * a band is not the viewport.
     */
    const band = this.bands.trailing
    const room = Math.max(120, Math.min(contentColumn(width), band.width - 16 * scale))
    const blockScale = Math.max(scale * MIN_BLOCK_SHRINK, Math.min(scale, (scale * room) / buttonWidth('compact', scale)))
    this.statusText.setFontSize(STATUS_FONT_SIZE * blockScale)
    this.statusText.setWordWrapWidth(room)

    const buttonH = buttonHeight('compact', blockScale)
    const gap = 10 * blockScale
    const blockH = this.statusText.height + gap + buttonH
    const status = bandCenter(band)
    // Centred in the band where it fits, and pushed off the bottom EDGE where it does not — the same
    // rule and the same reason as the board's own HUD: what is at the bottom of this block is a tap
    // target, and the bottom inset is the home indicator's. Measured at 360x640 the block wanted the
    // last 10px of the screen.
    const floor = height - screenInsets(this).bottom - 8 * scale
    const top = Math.max(this.topBar.height(this) + 8 * scale, Math.min(status.y - blockH / 2, floor - blockH))

    this.statusText.setPosition(status.x, top)
    this.hintButton.layout(status.x, top + this.statusText.height + gap + buttonH / 2, blockScale)
    this.refreshHintButton()
  }
}
