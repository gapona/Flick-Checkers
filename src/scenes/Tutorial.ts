import * as Phaser from 'phaser'
import { backgroundKey, SFX } from '../assets'
import { playSfx } from '../audio/audio'
import { bandCenter, BOARD_SCREEN_MARGIN_PX, computeAimZoom, computeBoardFit, computeHudBands, hudReserve, type BoardFit, type HudBands } from '../board/layout'
import { createBoardView, type BoardView } from '../board/boardView'
import { createDiscView, type DiscView } from '../board/discView'
import { createAimView, type AimView } from '../board/aimView'
import { boardSet } from '../game/skins'
import { activeBoardSet, activePieceSet, coinBalance } from '../game/wallet'
import { rememberTutorialDone } from '../game/persistence'
import { judgeLesson, LESSONS, lessonDiscs, readResult, type Lesson } from '../game/tutorial'
import { advance, createStepper, resetStepper, type Stepper } from '../sim/step'
import { applyImpulse, freezeIfStalled } from '../sim/shoot'
import { computeAim, discAt, firstContact, reachOf } from '../sim/aim'
import { createOutcome, type SimOutcome } from '../sim/outcome'
import { createSimConfig, createState, isMoving, type Disc, type SimConfig, type SimState } from '../sim/types'
import { logError } from '../platform/yt'
import { t } from '../i18n/strings'
import { bindAction, bindDrag } from '../platform/input'
import { getDisplayFontStack } from '../ui/font'
import { buttonHeight, buttonWidth, gameButton, type GameButton } from '../ui/button'
import { contentColumn, createTopBar, navBack, navMarkRoot, screenInsets, type TopBar } from '../ui/chrome'
import { bindLayout } from '../ui/layout'
import { uiScale } from '../ui/uiScale'

const TITLE_FONT_SIZE = 20
const LINE_FONT_SIZE = 15
/** Between the title, the line and the button, in design units. */
const ROW_GAP = 10
/** Matches `Game` and `Daily`. Same gesture, same board, same apron. */
const AIM_CAMERA_MS = 130
const BACKGROUND_OVERSCAN = 1.04
const BOARD_SIZE = 8
/** How far the button pair may be shrunk to fit a narrow band before it stops being readable.
 * `MainMenu`'s own floor, for the same trade. */
const MIN_BUTTON_SCALE = 0.7
/** How far the whole coach block may be shrunk to fit the band under the board before it stops
 * being readable — `Game`'s own `MIN_HUD_SHRINK`, for the same trade on the same phones. A band
 * that needs less than this is a band the block has to overhang instead. */
const MIN_BLOCK_SHRINK = 0.78

const TITLE_COLOR = '#ffc23c'
const LINE_COLOR = '#e6d8f5'

export interface TutorialData {
  /** Which lesson to open on. Only ever `0` today; the field exists so a future "replay lesson 4"
   * entry point needs no change here. */
  lesson?: number
}

/**
 * Six lessons on a live board.
 *
 * ## A separate scene, for the same reason `Daily` is one
 *
 * Almost nothing is shared with a match: no opponent, no turn, no round, no match, no bot, no
 * economy. What IS shared — the board, the disc layer, the aim gesture, the solver, the aim camera —
 * is shared as MODULES, which is the whole reason those were written as modules. The one thing this
 * scene owns that nothing else does is the lesson loop, and that is about forty lines of it.
 *
 * ## The lessons are data and the judging is pure
 *
 * `game/tutorial.ts` holds the board positions, the goals and the copy, with no Phaser in it, so
 * `tests/gameplay/tutorial.test.ts` can play every lesson through the real solver under plain node
 * and prove each is winnable. A lesson whose goal cannot be met is the one defect a tutorial must
 * not ship with, and it is invisible to every other check in this repository.
 *
 * ## Nothing here traps the player
 *
 * One button, always live: `Skip` before the goal is met and `Next` after it. A tutorial that will
 * not let go until you perform is a tutorial people quit the game inside. A failed attempt is not a
 * dead end either — the hint says what the failure just demonstrated, which is where lesson three
 * does its actual teaching, and the board goes back when the player taps rather than on a timer
 * (see {@link dismissHint}).
 *
 * ## The aim camera is here too
 *
 * Not because it is a match feature — it belongs to the GESTURE. Without it a disc on the rim
 * reaches full power pulling one way and about a quarter of it pulling the other, which is the same
 * drag meaning two different shots. On a screen whose entire job is teaching that drag, that is the
 * whole lesson broken. See CLAUDE.md "Aiming" for the measured numbers; `Daily` shipped without this
 * for months for exactly the "filed with the match machinery it sat next to" reason.
 */
export class Tutorial extends Phaser.Scene {
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

  private index = 0
  private lesson!: Lesson
  private shotsTaken = 0
  /** The goal is met; the board is now a trophy rather than a puzzle and the aim gate is shut. */
  private passed = false
  /** A failed attempt is on screen with its hint, and the board goes back on the next tap. Also
   * shuts the aim gate — a shot fired at the mistake still standing on the board would land on a
   * position that is about to be replaced, on a board nobody was looking at. */
  private resetting = false

  private topBar!: TopBar
  private titleText!: Phaser.GameObjects.Text
  private lineText!: Phaser.GameObjects.Text
  private actionButton!: GameButton
  /**
   * Back one lesson, disabled on the first.
   *
   * The lessons build on each other — lesson three's punchline only lands if you remember lesson
   * two's reach — and until this existed there was no way to re-read one you had walked past.
   * Reported alongside the guided tour's missing Back, from the same session and in the same words.
   * Disabled rather than absent for the reason `Coach`'s own Back gives: the block's height is
   * measured, and a control that appears at lesson two would move everything under it.
   */
  private backButton!: GameButton

  private viewportW = 0
  private viewportH = 0
  private fit!: BoardFit
  private bands!: HudBands
  /** Where the world camera points, tracked here rather than read back off it — `Camera.midPoint`
   * is only refreshed during preRender, so asking at the instant a gesture starts hands back the
   * previous frame's value. */
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
    super('Tutorial')
  }

  create(data: TutorialData = {}) {
    // Cleared explicitly: Phaser re-uses the scene INSTANCE across restarts, so a second visit would
    // otherwise open on whichever lesson the first one left behind.
    this.index = Phaser.Math.Clamp(Math.floor(data.lesson ?? 0), 0, LESSONS.length - 1)
    this.shotsTaken = 0
    this.passed = false
    this.resetting = false
    this.shotOutcome = null
    this.aiming = null

    this.background = this.add.image(0, 0, backgroundKey(boardSet(activeBoardSet()).background)).setOrigin(0.5).setDepth(-1000)
    // A plain board: no pits and no bumpers. A lesson about the gesture must not also be a lesson
    // about a mode, and `helpModesTitle` is where the modes are explained.
    this.board = createBoardView(this, BOARD_SIZE, { pits: [] }, activeBoardSet())
    this.simConfig = createSimConfig(this.board.metrics)
    this.stepper = createStepper()
    this.discView = createDiscView(this, () => this.syncCameraMembership(), { pieces: activePieceSet() })
    this.aimView = createAimView(this)

    this.titleText = this.add
      .text(0, 0, '', { fontFamily: getDisplayFontStack(), fontSize: TITLE_FONT_SIZE, color: TITLE_COLOR, align: 'center' })
      .setOrigin(0.5, 0)
      .setShadow(0, 2, 'rgba(0,0,0,0.8)', 4)
    // Origin at the TOP, not the centre, for the reason CLAUDE.md's "Known Issues Fixed" records
    // about the opponent's line in `Game`: this text grows from one line to three as the lesson
    // moves from brief to hint, and a centred object grows in BOTH directions — upward, over the
    // title.
    this.lineText = this.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: LINE_FONT_SIZE, color: LINE_COLOR, align: 'center' })
      .setOrigin(0.5, 0)
      .setShadow(0, 2, 'rgba(0,0,0,0.8)', 4)

    this.actionButton = gameButton(this, { size: 'compact', variant: 'ghost', label: t('tutSkip') })
    bindAction(this, 'tutorialAdvance', { pointer: this.actionButton.hitArea, keys: ['ENTER', 'SPACE'] }, () => this.advanceLesson())
    this.backButton = gameButton(this, { size: 'icon', variant: 'ghost', icon: '‹' })
    // Not ESC: the top bar already owns that, and it LEAVES. A key that sometimes goes back one
    // lesson and sometimes leaves the tutorial is a key nobody presses twice.
    bindAction(this, 'tutorialBack', { pointer: this.backButton.hitArea, keys: ['BACKSPACE', 'LEFT'] }, () => this.previousLesson())

    this.topBar = createTopBar(this, {
      back: true,
      onBack: () => navBack(this),
      /**
       * **No round pill**, and the counter is in the coach block instead.
       *
       * The top bar's centre slot sits over the BOARD in landscape — measured at 844x390, "1 / 6"
       * was drawn a few pixels from a disc and read as a label on it. `Game` never shows this,
       * because its landscape layout hands the badges to the side panel; the tutorial has no panel,
       * so the slot would be over the playing field on exactly the orientation it is used in. Same
       * lesson as the perimeter turn light that got removed for being read as scenery: a signal
       * drawn on the field is read as being about the field.
       */
      round: false,
      onSettings: () => {
        playSfx(SFX.ui)
        this.scene.pause()
        this.scene.launch('Settings', { opener: 'Tutorial' })
      },
    })
    this.topBar.setCoins(coinBalance())

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    for (const object of [this.titleText, this.lineText, this.actionButton.container, this.backButton.container, ...this.topBar.objects]) {
      this.cameras.main.ignore(object)
    }

    // A failed attempt waits for the player rather than for a clock — see {@link dismissHint}. On
    // the scene's own input rather than on the board, because "tap anywhere" is what the hint says
    // and the board is only the middle of the screen.
    this.input.on(Phaser.Input.Events.POINTER_UP, () => this.dismissHint())

    bindDrag(this, 'aimTutorial', this.board.hitTarget, {
      onStart: (pointer) => this.beginAim(pointer),
      onMove: (pointer) => this.updateAim(pointer),
      onEnd: (pointer) => this.releaseAim(pointer),
      onCancel: () => this.cancelAim(),
    })

    bindLayout(this, (width, height) => this.layout(width, height))
    this.loadLesson(this.index)
  }

  // -- the lesson loop -------------------------------------------------------------------------

  private loadLesson(index: number): void {
    this.index = index
    this.lesson = LESSONS[index]
    this.passed = false
    this.shotsTaken = 0
    // The counter lives with the lesson it counts — see the top bar's own note above.
    this.titleText.setText(`${index + 1} / ${LESSONS.length}  ·  ${t(this.lesson.titleKey)}`)
    this.actionButton.setVariant('ghost')
    this.actionButton.setLabel(t('tutSkip'))
    this.backButton.setEnabled(index > 0)
    this.resetBoard()
    this.say(t(this.lesson.briefKey))
  }

  /**
   * The hint stays up until the player is done with it, and then the board goes back.
   *
   * **It used to go back on a timer** (1100ms), which is long enough to see a disc finish falling
   * and nowhere near long enough to READ two sentences of explanation — so the one line in the
   * lesson that says what the failure just demonstrated was gone before it had been taken in.
   * Reported that way, and a timer cannot be tuned out of it: the right pause is however long this
   * particular player needs, which is a number only they have.
   *
   * **On the RELEASE, not the press.** `beginAim` refuses while `resetting`, so a press cannot
   * become an aim — but a press that both dismissed the hint and cleared the gate would let the
   * same finger start a shot on a board it has not seen yet, and the order the two listeners fire in
   * is Phaser's business rather than ours. Waiting for the up takes the question away entirely.
   */
  private dismissHint(): void {
    // A paused scene keeps receiving input (see `platform/input.ts`), and the lesson may have been
    // skipped past or solved since the hint went up.
    if (!this.resetting || !this.scene.isActive() || this.passed) return
    this.resetBoard()
    this.say(t(this.lesson.briefKey))
  }

  /** Puts the lesson's own position back, exactly as written. A retry has to be the SAME lesson
   * rather than a slightly nudged one — same reason `Daily` keeps a pristine copy. */
  private resetBoard(): void {
    this.sim = createState(lessonDiscs(this.lesson, this.board.metrics))
    this.shotOutcome = null
    this.aiming = null
    this.resetting = false
    resetStepper(this.stepper)
    this.aimView.hide()
    this.discView.reset(this.sim)
    this.syncCameraMembership()
  }

  /** The one shot has settled: passed, failed, or nothing decided yet. */
  private settle(): void {
    const outcome = this.shotOutcome
    this.shotOutcome = null
    if (!outcome) return

    const result = readResult(outcome, this.sim)
    switch (judgeLesson(this.lesson, result, this.shotsTaken)) {
      case 'passed':
        this.passed = true
        playSfx(SFX.win)
        this.say(t(this.lesson.doneKey))
        this.actionButton.setVariant('gold')
        this.actionButton.setLabel(this.index === LESSONS.length - 1 ? t('tutFinish') : t('tutNext'))
        return
      case 'failed':
        // No `lose` cue. It plays over a mistake the player is being asked to LEARN from, and a
        // failure sting on lesson three — where losing your own disc is the entire point — reads as
        // the game telling you off for doing the thing it just showed you.
        this.resetting = true
        this.say(`${t(this.lesson.hintKey)} ${t('tutRetry')}`)
        return
      case 'again':
        return
    }
  }

  /**
   * `Skip` and `Next` are one button and one handler on purpose: both mean "I am done with this
   * lesson", and the only thing that differs is whether the player solved it. Two buttons would put
   * a permanent Skip beside a Next that only sometimes exists, which is a row that changes shape
   * under the player's thumb.
   */
  /** One lesson back, from the top. Guarded rather than hidden on the first — see {@link backButton}. */
  private previousLesson(): void {
    if (this.index === 0) return
    playSfx(SFX.ui)
    this.loadLesson(this.index - 1)
  }

  private advanceLesson(): void {
    if (this.index < LESSONS.length - 1) {
      playSfx(SFX.ui)
      this.loadLesson(this.index + 1)
      return
    }
    this.finish()
  }

  /**
   * The end.
   *
   * **`rememberTutorialDone()` fires here whether the lessons were solved or skipped**, and that is
   * deliberate: skipping is a real answer, and a menu that keeps offering the tutorial to somebody
   * who has already decided about it is nagging. Backing out through the top bar does NOT set it —
   * that is leaving, not finishing, and the offer should survive it.
   */
  private finish(): void {
    rememberTutorialDone()
    this.scene.pause()
    this.scene.launch('Confirm', {
      opener: 'Tutorial',
      message: t('tutDone'),
      choices: [
        {
          label: t('tutPlayMatch'),
          variant: 'gold' as const,
          // `navMarkRoot` first: the tutorial may have been reached from the menu, and leaving the
          // entry on the stack would point `Modes`' back button at a tutorial already finished.
          onPick: () => {
            navMarkRoot(this)
            this.scene.start('Modes')
          },
        },
        {
          label: t('howToPlay'),
          variant: 'ghost' as const,
          onPick: () => {
            navMarkRoot(this)
            this.scene.start('HowToPlay')
          },
        },
        {
          label: t('navHome'),
          variant: 'ghost' as const,
          onPick: () => {
            navMarkRoot(this)
            this.scene.start('MainMenu')
          },
        },
      ],
    })
  }

  private say(line: string): void {
    this.lineText.setText(line)
    // After the text, never before: the block is centred on what it CONTAINS, and a line that grows
    // from one row to three without a re-layout is a line drawn over the title above it.
    this.layout(this.scale.width, this.scale.height)
  }

  // -- the board -------------------------------------------------------------------------------

  private syncCameraMembership(): void {
    this.uiCamera.ignore([this.background, ...this.board.worldObjects, ...this.discView.worldObjects, ...this.aimView.worldObjects])
  }

  private worldPoint(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    return this.cameras.main.getWorldPoint(pointer.x, pointer.y)
  }

  /** Pulls the camera back so the slingshot has somewhere to be pulled TO — see the class comment. */
  private enterAimCamera(): void {
    const target = computeAimZoom(this.board.metrics, this.viewportW, this.viewportH)
    if (target >= this.fit.zoom) return
    const { boardW, boardH } = this.board.metrics
    this.moveCamera(target, boardW / 2, boardH / 2)
  }

  /** Back to the resting fit, from every ending the gesture has. A camera left zoomed out is a
   * board that never comes back. */
  private leaveAimCamera(): void {
    const { boardW, boardH } = this.board.metrics
    if (this.cameraTargetZoom === this.fit.zoom) return
    this.moveCamera(this.fit.zoom, boardW / 2, boardH / 2)
  }

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
        this.setCamera(from.zoom + (zoom - from.zoom) * step.t, from.x + (focusX - from.x) * step.t, from.y + (focusY - from.y) * step.t)
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
    if (this.passed || this.resetting || isMoving(this.sim)) return false
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
    this.shotsTaken++
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
        console.error('[sim] a tutorial shot ran past the time ceiling and was frozen', this.shotOutcome)
        logError()
      }
      return
    }

    resetStepper(this.stepper)
    this.discView.draw(this.sim, 1)
    if (this.shotOutcome) this.settle()
  }

  // -- layout ----------------------------------------------------------------------------------

  private applyCamera(): void {
    const { boardW, boardH } = this.board.metrics
    // A resize DURING an aim re-enters here. Snapping to the resting fit would yank the apron out
    // from under a drag still being made, so the aim's own zoom is re-applied instead — instantly,
    // because a resize is not an animation.
    const zoom = this.aiming ? computeAimZoom(this.board.metrics, this.viewportW, this.viewportH) : this.fit.zoom
    this.cameraTween?.stop()
    // The instant path writes the intent too — otherwise a resize mid-gesture would leave
    // `cameraTargetZoom` describing a move that no longer happened. See its own comment.
    this.cameraTargetZoom = zoom
    this.setCamera(zoom, boardW / 2, boardH / 2)

    const visibleW = this.viewportW / this.fit.zoom
    const visibleH = this.viewportH / this.fit.zoom
    this.board.coverWorldView(new Phaser.Geom.Rectangle(boardW / 2 - visibleW / 2, boardH / 2 - visibleH / 2, visibleW, visibleH))

    // Sized on the AIM zoom, not the resting fit: the plate is a world-space object, the camera
    // scales it too, and the aim zooms OUT — so the world rectangle on screen is at its LARGEST
    // exactly while a gesture is being made. See `Daily.applyCamera` for the bug this prevents.
    const widestZoom = Math.min(this.fit.zoom, computeAimZoom(this.board.metrics, this.viewportW, this.viewportH))
    const cover = Math.max(this.viewportW / widestZoom / this.background.width, this.viewportH / widestZoom / this.background.height) * BACKGROUND_OVERSCAN
    this.background.setPosition(boardW / 2, boardH / 2).setScale(cover)
  }

  layout(width: number, height: number): void {
    this.viewportW = width
    this.viewportH = height
    // Same reserve as `Game`: the coach block lives in the band this leaves. See `hudReserve`.
    this.fit = computeBoardFit(this.board.metrics, width, height, BOARD_SCREEN_MARGIN_PX, hudReserve(width, height, uiScale(width), 'bands'))
    this.bands = computeHudBands(width, height, this.fit.boardPx)
    this.applyCamera()
    this.uiCamera.setViewport(0, 0, width, height)

    const scale = uiScale(width)
    this.topBar.layout(width, height)

    const band = this.bands.trailing
    const centre = bandCenter(band)

    /**
     * Where the block may stand: below the top bar, above the bottom inset, and — in portrait —
     * below the BOARD.
     *
     * The last of those is the one that was missing. `band.y` is the board's bottom edge in
     * portrait and zero in landscape, so taking the larger of it and the bar's own ceiling is one
     * expression for both orientations.
     */
    const ceiling = Math.max(this.topBar.height(this) + 8 * scale, band.y)
    // …and clear of the BOTTOM edge as well. In portrait the trailing band runs to the last pixel of
    // the viewport, so a block that fills it puts a tap target on the home indicator: measured at
    // 360x640, the back button ended 1px from the edge. Same clamp, same reason, as the board's HUD.
    const floor = height - screenInsets(this).bottom - 8 * scale
    const room = floor - ceiling

    /**
     * The block is FITTED to that room, not merely centred in it — and a short phone is why.
     *
     * `uiScale` reads the WIDTH, which is the right question for text and the wrong one for a stack
     * of rows whose room is whatever a square board left over VERTICALLY. Measured at 375x664 (a
     * 1.77:1 phone, where the square board leaves a 152px band against a block that wants ~170): the
     * clamp below pushed the block up until its title was drawn across the board's bottom rank, and
     * the report was a screenshot of exactly that — "должно быть внизу".
     *
     * **Measured each pass rather than divided once**: a `Text`'s height quantises to whole lines, so
     * the block does not shrink smoothly with the scale — a smaller font can drop a wrapped line and
     * come in well under. Same finding, and the same three passes, as `Game.layoutHud`'s own
     * `measureTrailingStack`.
     *
     * `MIN_BLOCK_SHRINK` is a real floor: past it the hint is too small to read, and an unreadable
     * lesson is worse than one that overlaps the board it is about.
     */
    let blockScale = scale
    let block = this.measureBlock(width, band, blockScale, scale)
    for (let pass = 0; pass < 3 && block.height > room; pass += 1) {
      const next = Math.max(scale * MIN_BLOCK_SHRINK, blockScale * (room / block.height))
      if (next >= blockScale) break
      blockScale = next
      block = this.measureBlock(width, band, blockScale, scale)
    }

    /**
     * Centred in what is left, and pushed off the bottom edge when it still does not fit.
     *
     * **The ceiling is landscape's, and without it the coach runs under the gear.** In landscape the
     * band is the full-height strip beside the board and the top bar crosses it, with the gear
     * sitting in the trailing one. Measured at 740x360: the block is about 220 tall in a 360 band, so
     * centring alone put its title at y 70 against a gear occupying 28 to 92.
     */
    const top = Math.max(ceiling, Math.min(centre.y - block.height / 2, floor - block.height))
    const gap = ROW_GAP * blockScale

    this.titleText.setPosition(centre.x, top)
    this.lineText.setPosition(centre.x, top + this.titleText.height + gap)
    if (block.stacked) {
      // The action first and Back under it — `scenes/Coach.ts`'s own order, for the same reason: the
      // button somebody presses to move ON is the one that should be where the eye already is.
      const actionY = top + block.height - block.rowsH + block.rowH / 2
      this.actionButton.layout(centre.x, actionY, block.rowScale)
      this.backButton.layout(centre.x, actionY + block.rowH + ROW_GAP * block.rowScale, block.rowScale)
    } else {
      const rowY = top + block.height - block.rowH / 2
      const rowLeft = centre.x - block.rowW / 2
      this.backButton.layout(rowLeft + block.backW / 2, rowY, block.rowScale)
      this.actionButton.layout(rowLeft + block.backW + ROW_GAP * block.rowScale + block.actionW / 2, rowY, block.rowScale)
    }
  }

  /**
   * Sizes the coach block at one scale and reports what it came to.
   *
   * Sizing and measuring are the same pass on purpose: a `Text`'s height is only knowable once its
   * font size and wrap width are set, so anything that wants the height has to have written both
   * first. The caller may therefore call this several times, and the LAST call is what stands.
   *
   * `uiScale` is passed separately from the block's own scale because the two answer different
   * questions: the block's scale is how far it has been shrunk to fit its band, while the band's own
   * padding is screen furniture and stays at the screen's scale.
   */
  private measureBlock(
    width: number,
    band: { x: number; y: number; width: number; height: number },
    blockScale: number,
    scale: number,
  ): { height: number; rowH: number; rowsH: number; rowW: number; rowScale: number; backW: number; actionW: number; stacked: boolean } {
    // The band is the full viewport width in portrait and a narrow side strip in landscape, so the
    // wrap has to be the SMALLER of the two rules — the content column keeps a desktop from
    // stretching one sentence across a metre, the band keeps a landscape phone inside its strip.
    const wrap = Math.max(120, Math.min(contentColumn(width), band.width - 24 * scale))
    this.titleText.setFontSize(TITLE_FONT_SIZE * blockScale)
    this.titleText.setWordWrapWidth(wrap)
    this.lineText.setFontSize(LINE_FONT_SIZE * blockScale)
    this.lineText.setWordWrapWidth(wrap)

    const gap = ROW_GAP * blockScale
    /**
     * The pair SHRINKS to the band rather than stacking or overflowing, and both alternatives were
     * tried before this.
     *
     * Overflowing is what shipped for an afternoon: the trailing band in landscape is a side strip
     * beside the board — 198 units wide at 740x360 against a 242-unit pair — so the row ran 22px off
     * the right of the viewport. Stacking fixed the width and broke the height instead: two rows plus
     * the wrapped hint came to 294 units in a 360-tall screen whose top bar already owns the first 96,
     * and the block simply ran off the bottom.
     *
     * Exact in one division, unlike the side panel's own pairs: every token in this kit is
     * `SIZES[size].w * scale`, so the row's width is strictly proportional and there is no text metric
     * in it to quantise. Legibility is what it costs and reachability is not — `gameButton` floors
     * every hit area at `MIN_TOUCH_TARGET` however small the face is drawn.
     */
    const wanted = buttonWidth('icon', blockScale) + gap + buttonWidth('compact', blockScale)
    const rowScale = Math.max(blockScale * MIN_BUTTON_SCALE, Math.min(blockScale, (blockScale * (band.width - 16 * scale)) / wanted))
    const actionW = buttonWidth('compact', rowScale)
    const backW = buttonWidth('icon', rowScale)
    /**
     * …and STACKED when even the floor is wider than the band.
     *
     * The pair shrinks to the band first, which is enough on every phone; it is not enough on a
     * squarish landscape, where the band is a ~160px strip against a 242-unit row that will not go
     * below `MIN_BUTTON_SCALE`. Stacking was tried and rejected once — see the note above — but that
     * was about a 360-TALL landscape, where two rows plus a wrapped hint ran off the bottom. In this
     * shape the band is the full height of a 455px viewport, so height is exactly what there is
     * plenty of. The condition is the honest one: stack only when the row genuinely does not fit.
     */
    const stacked = backW + ROW_GAP * rowScale + actionW > band.width - 16 * scale
    // The TALLER of the two tokens: `icon` is 64 design units against `compact`'s 56, so measuring the
    // block by the action alone left the back button hanging 8 units past the bottom of it — one pixel
    // from the edge of a 360x640 phone, and a cut through the guided tour's ring around it.
    const rowH = Math.max(buttonHeight('compact', rowScale), buttonHeight('icon', rowScale))

    const rowsH = stacked ? rowH * 2 + ROW_GAP * rowScale : rowH
    return {
      height: this.titleText.height + gap + this.lineText.height + gap + rowsH,
      rowH,
      rowsH,
      rowW: stacked ? Math.max(backW, actionW) : backW + ROW_GAP * rowScale + actionW,
      rowScale,
      backW,
      actionW,
      stacked,
    }
  }
}
