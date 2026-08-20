import * as Phaser from 'phaser'
import { backgroundKey, SFX } from '../assets'
import { playSfx } from '../audio/audio'
import { bandCenter, computeAimZoom, computeBoardFit, computeHudBands, type BoardFit, type HudBands } from '../board/layout'
import { createBoardView, type BoardView } from '../board/boardView'
import { boardSet } from '../game/skins'
import { createDiscView, type DiscView } from '../board/discView'
import { createAimView, type AimView } from '../board/aimView'
import { asCatalog, boardFor, DAILY_CATALOG_KEY, puzzleFor, type DailyRecord } from '../daily/catalog'
import { dailyConfig, dateKey, isSolved } from '../daily/puzzle'
import { dailyStatus, recordDailySolved, type DailyStatus } from '../daily/streak'
import { activeBoardSet, activePieceSet, awardCoins, coinBalance } from '../game/wallet'
import { DAILY_REWARD } from '../game/economy'
import { advance, createStepper, resetStepper, type Stepper } from '../sim/step'
import { applyImpulse, freezeIfStalled } from '../sim/shoot'
import { computeAim, discAt, firstContact, reachOf } from '../sim/aim'
import { createOutcome, type SimOutcome } from '../sim/outcome'
import { cloneState, isMoving, liveDiscs, type Disc, type SimConfig, type SimState } from '../sim/types'
import { logError } from '../platform/yt'
import { t } from '../i18n/strings'
import { bindAction, bindDrag } from '../platform/input'
import { createTopBar, navBack, navMarkRoot, type TopBar } from '../ui/chrome'
import { bindLayout } from '../ui/layout'
import { uiScale } from '../ui/uiScale'

/** How long the falling discs get to themselves before the result panel covers the board. */
const RESULT_DELAY_MS = 700

const STATUS_FONT_SIZE = 18
const BACKGROUND_OVERSCAN = 1.04
/** Matches `Game`'s. The daily is the same gesture on the same board, so it gets the same camera —
 * a pull that has room to be pulled in one mode and not in the other is two different games. */
const AIM_CAMERA_MS = 130
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

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    for (const object of [this.statusText, ...this.topBar.objects]) {
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
  }

  private syncCameraMembership(): void {
    this.uiCamera.ignore([this.background, ...this.board.worldObjects, ...this.discView.worldObjects, ...this.aimView.worldObjects])
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
    if (this.cameras.main.zoom === this.fit.zoom) return
    this.moveCamera(this.fit.zoom, boardW / 2, boardH / 2)
  }

  /** Eases the world camera, writing {@link focus} from the same code that moves it so the two
   * cannot drift apart. */
  private moveCamera(zoom: number, focusX: number, focusY: number): void {
    const camera = this.cameras.main
    this.cameraTween?.stop()

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

  private refreshStatus(): void {
    const status = dailyStatus(this.today)

    if (this.done && this.solved) {
      this.statusText.setText([t('dailySolved'), t('dailyStreak', { n: status.streak })].join('\n'))
      return
    }
    if (this.done) {
      this.statusText.setText([t('dailyMissed'), t('tapToPlayAgain')].join('\n'))
      return
    }
    if (status.solvedToday) {
      this.statusText.setText([t('dailyAlreadyDone'), t('dailyStreak', { n: status.streak })].join('\n'))
      return
    }

    this.statusText.setText([t('dailyTitle'), t('dailyGoal')].join('\n'))
  }

  private applyCamera(): void {
    const { boardW, boardH } = this.board.metrics
    // A resize DURING an aim re-enters here. Snapping to the resting fit would yank the apron out
    // from under a drag still being made, so the aim's own zoom is re-applied instead — and
    // instantly, because a resize is not an animation.
    const zoom = this.aiming ? computeAimZoom(this.board.metrics, this.viewportW, this.viewportH) : this.fit.zoom
    this.cameraTween?.stop()
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
    this.fit = computeBoardFit(this.board.metrics, width, height)
    this.bands = computeHudBands(width, height, this.fit.boardPx)
    this.applyCamera()
    this.uiCamera.setViewport(0, 0, width, height)

    const scale = uiScale(width)

    this.topBar.layout(width, height)
    this.statusText.setFontSize(STATUS_FONT_SIZE * scale)

    const status = bandCenter(this.bands.trailing)
    this.statusText.setPosition(status.x, status.y - this.statusText.height / 2)
  }
}
