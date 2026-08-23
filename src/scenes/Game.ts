import * as Phaser from 'phaser'
import { ATLAS_FRAMES, ATLAS_KEY, backgroundKey, SFX } from '../assets'
import { playSfx } from '../audio/audio'
import { bandCenter, computeAimZoom, computeBoardFit, computeHudBands, computeSidePanel, type SidePanelFit, createBoardMetrics, type BoardFit, type HudBands, type Rect } from '../board/layout'
import { createBoardView, type BoardView } from '../board/boardView'
import { boardSet, effectSet, pieceSet, type EffectBurst, type EffectSet } from '../game/skins'
import { createDiscView, type DiscView } from '../board/discView'
import { createAimView, type AimView } from '../board/aimView'
import { getRuleSet, type RuleSet, type FormationId } from '../game/rules'
import {
  clearMatch,
  currentOpponent,
  currentRulesId,
  loadMatch,
  savedRoundIsOver,
  recordCombo,
  recordResult,
  recordScore,
  rememberDefeated,
  saveMatch,
} from '../game/persistence'
import { shouldRunTour } from '../game/tour'
import type { CoachStep } from './Coach'
import type { Opponent, SpeechTrigger } from '../game/opponents'
import { speechDirector, type SpeechDirector } from '../game/speech'
import { createDialogueVoice, type DialogueVoiceManager } from '../audio/dialogueVoice'
import type { VoiceMood } from '../audio/voiceRegistry'
import { speechLine, SPEECH_TYPE_MS, type SpeechLine } from '../ui/speechLine'
import { makePortrait, placePortrait, portraitWidthFor, reactPortrait } from '../ui/portrait'
import { buildFormation, BRANCH_PROFILES, FORMATION_ORDER } from '../game/formations'
import { hazardsFor, type Hazards } from '../game/hazards'
import { createMatch, currentFormation, recordRound, roundNumber, MATCH_ROUNDS, type MatchState } from '../game/match'
import { scoreShot, type ShotScore } from '../game/scoring'
import { POWER_SHOT_ITEM, RETAKE_ITEM } from '../game/economy'
import { activeBoardSet, activePieceSet, awardComboCoins, awardMatchCoins, awardRoundCoins, coinBalance, spendOn, activeEffectSet} from '../game/wallet'
import { advance, createStepper, resetStepper, type Stepper } from '../sim/step'
import { applyImpulse, freezeIfStalled } from '../sim/shoot'
import { computeAim, discAt, firstContact, reachOf, type Aim } from '../sim/aim'
import { createOutcome, enemyKnockouts, ownKnockouts, peakImpact, type Impact, type SimOutcome } from '../sim/outcome'
import { cloneRound, createRound, forfeitShot, resolveShot, summarise, type RoundState, type ShotResolution } from '../game/round'
import { personaLevel, type BotLevel } from '../bot/levels'
import { DEFAULT_WEIGHTS } from '../bot/evaluate'
import { createSearch, type BotSearch } from '../bot/search'
import { createRandom, type Random } from '../bot/random'
import { sendScore } from '../platform/yt'
import { leaveConfirm } from './Confirm'
import { createGamePanel, type GamePanel } from '../ui/gamePanel'
import { createPlayerBlock, type PlayerBlock } from '../ui/playerBlock'
import { discTextureKey, ensureDiscTextures } from '../board/discTextures'
import type { MatchResultData } from './MatchResult'
import { CELL, cloneState, createSimConfig, createState, findDisc, isMoving, liveDiscs, MAX_SPEED, type Disc, type SimConfig, type SimState, type Side } from '../sim/types'
import { logError } from '../platform/yt'
import { t, type StringKey } from '../i18n/strings'
import { bindAction, bindDrag } from '../platform/input'
import { anchorTopLeft, anchorTopRight } from '../ui/anchors'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { gameButton, type GameButton } from '../ui/button'
import { createTopBar, navBack, screenInsets, type TopBar, navTo} from '../ui/chrome'
import { createDiscCounter, type DiscCounter } from '../ui/discCounter'
import { safeAreaTop } from '../ui/safeArea'
import { getTheme, neonButton, valueBadge, type NeonButton, type ValueBadge } from '../ui/theme'
import { ensureMinHitArea, uiScale } from '../ui/uiScale'

const GEAR_FONT_SIZE = 32
const STATUS_FONT_SIZE = 18
const COINS_FONT_SIZE = 18
const DEBUG_FONT_SIZE = 11
const ACTION_FONT_SIZE = 15
/** Clearance between the status line and the consumables. Generous because the status text carries
 * a drop shadow, which reaches past the height Phaser reports for it. */
const ACTION_GAP = 26
/** The opponent's spoken line. Smaller than the status it sits under, and in the opponent's own
 * violet rather than the status grey, so a quip is never mistaken for the turn readout. */
const SPEECH_FONT_SIZE = 14
const SPEECH_COLOR = '#c98cff'
/**
 * The opponent's drawn height in the HUD, in design units.
 *
 * Small enough to sit in a band beside the status capsule on a 390px phone, large enough that a
 * face is a face — under about 50 the cast stops being distinguishable character from character,
 * which would make showing them pointless.
 *
 * **It grows UPWARD**, because `layoutPortrait` stands the figure's feet on the bottom of the
 * reserved speech row — so a taller face reaches further into the empty part of the band rather than
 * down into the consumable buttons. That is what makes 78 safe here where it would not be if the
 * portrait were anchored by its top.
 */
const HUD_PORTRAIT_HEIGHT = 78
/** Between the portrait's box and the status capsule beside it. */
const PORTRAIT_GAP = 10
/**
 * The row the opponent's line occupies, RESERVED whether or not one is being spoken.
 *
 * Two things need it. The buttons below it must not jump down every time a character says something
 * — a control that moves under the thumb about to press it is worse than one placed slightly low.
 * And the row was not in the portrait-orientation block's arithmetic at all, so a line was drawn
 * straight through the consumable buttons; that was always true and became visible when the face
 * arrived and anchored itself to the bottom of the row.
 *
 * Two lines' worth, because the wrap width is the status capsule's and a longer quip uses both —
 * and DERIVED from the font rather than picked, because the two have to agree. At 34 it was a line
 * and a half: the second line of "Lost one. Hold the line." hung out of the bottom of the row that
 * exists to contain it. Phaser lays a line out at about 1.28x the font size.
 */
const SPEECH_LINE_HEIGHT = SPEECH_FONT_SIZE * 1.28
/** Height of each player block in the side panel, in design units — the reference's own 96,
 * which is what fits a 76-unit face with air around it. */
const PANEL_BLOCK_HEIGHT = 96
/** What a block may shrink to before the face stops reading as a person. */
const PANEL_BLOCK_MIN_HEIGHT = 68
/** One line of the opponent's speech, which is the least the middle zone is worth keeping. */
/** How far the panel's four actions may be shrunk to keep them in two rows. Below this the pairs
 * split again and the panel is honestly out of room. Their TAP TARGETS are unaffected. */
const PANEL_MIN_ACTION_SCALE = 0.6

const PANEL_SPEECH_MIN_HEIGHT = 34

const SPEECH_ROW_HEIGHT = Math.ceil(SPEECH_LINE_HEIGHT * 2) + 4
/** Clear space kept between the portrait HUD block and both ends of its own band. */
const HUD_BAND_MARGIN = 10
/**
 * How far the portrait HUD block may be shrunk to fit a short screen, as a fraction of `uiScale`.
 *
 * 0.78 is what 320x568 — the shortest thing this game is checked at — actually needs; below that the
 * price on a consumable button stops being readable, and a HUD nobody can read is worse than one
 * that overhangs by a pixel. If a viewport ever needs less than this, the band is too small for the
 * block and something has to LEAVE it rather than shrink further.
 */
const MIN_HUD_SHRINK = 0.78
/** Discs left before a character starts talking about it. */
const LOW_DISCS = 2

/** How much §8's power shot raises the impulse ceiling. Enough to reach across the board from a
 * standing start, not enough to make aiming irrelevant. */
const POWER_SHOT_MULTIPLIER = 1.35
const BACKGROUND_OVERSCAN = 1.04

/** How long the camera takes to pull back for an aim, and to come back afterwards. Short enough
 * that it is finished before a drag has travelled far, long enough not to read as a jump. */
const AIM_CAMERA_MS = 130

/** The board is 8×8 in every rule set (`game/rules.ts`). Read from one place so the day a variant
 * wants a wider board, this is a lookup rather than a search. */
const BOARD_SIZE = 8

/** The side the human plays. The other one is the bot's. */
const PLAYER_SIDE = 'player' as const
const BOT_SIDE = 'opponent' as const

/**
 * Milliseconds of bot search allowed per frame (GAME-PLAN.md §6).
 *
 * A Hard search is ~500 solver runs, about 100ms in one go — a visible freeze. Spread over frames at
 * this budget it costs a fifth of a second of "thinking", which the game has to show anyway for the
 * move to read as a decision rather than a twitch.
 */
const BOT_FRAME_BUDGET_MS = 8

/** How fast the thinking ellipsis animates. */
const THINKING_DOT_MS = 320

export interface GameData {
  /** Continue the saved match rather than starting a new one. `MainMenu`'s Continue button sets it;
   * New game does not, and a new game deliberately DISCARDS whatever was saved. */
  resume?: boolean
  /**
   * Two people on one device, taking turns at the same board — `Modes`' second start button.
   *
   * **Almost nothing here is new machinery.** `game/round.ts` has always been side-agnostic: it owns
   * whose turn it is and how many shots they owe without caring what fills a turn, and this scene's
   * aim gate was written that way too — S6 played both sides from one seat, and S7 replaced the
   * opponent's half with the bot and nothing else. This flag puts that half back.
   *
   * What it also does, and this is the part that is not free, is switch OFF everything the single
   * player game hangs off "the player": coins, the leaderboard score, the ladder unlock, the run
   * stats, the consumables and the whole cast. See `isSolo` below.
   *
   * Ignored on a resume — the saved record decides, because it knows which kind of match it is.
   */
  twoPlayer?: boolean
}

/**
 * §5's slow-motion finish: when a shot leaves the opponent with nothing on the board, the last
 * moments run at this rate for this long.
 *
 * "Cheap, and reads as cinematic" is exactly right — it is two lines against Phaser's own time
 * scale. It fires only on the shot that ENDS a round, so it stays an event rather than a mannerism.
 */
const SLOWMO_SCALE = 0.4
const SLOWMO_MS = 620

/**
 * The impact sound, scaled by collision energy (§9).
 *
 * §9 calls this the game's main sound and is emphatic about why it cannot be a flat sample: "it has
 * to be proportional to the force, otherwise a weak and a strong hit sound the same and the physics
 * stops being felt." Volume and pitch both ride the closing speed, and the pitch range is wide
 * enough to hear — a 10% wobble is not a cue, it is a defect.
 */
const IMPACT_MIN_VOLUME = 0.18
const IMPACT_MAX_VOLUME = 1
const IMPACT_MIN_RATE = 0.72
const IMPACT_MAX_RATE = 1.5
/** Below this closing speed a contact is a nudge, and silence is the honest answer. */
const IMPACT_SILENT_BELOW = 0.6 * CELL

/** Above the discs, below nothing — a combo pop that a disc could cover would be a combo pop
 * nobody sees, and it outlives the shot by a second anyway. */
const COMBO_DEPTH = 50
/** §5: "lives a second and a half and takes no permanent space". */
const COMBO_LIFE_MS = 1500

/** §5's combo cue: every extra disc in one shot raises the pitch a step, "like the snap in Neon
 * Puzzle". */
const COMBO_RATE_STEP = 0.12

/**
 * The burst thrown off a disc as it leaves the board.
 *
 * §5 is about making the physics felt, and losing a disc is the loudest thing that happens in a
 * round — it already has a sound and a fall animation, and until now nothing at the point of
 * departure. The art for it has shipped in the atlas since the atlas was generated
 * (`particle-spark`, `particle-shard`) and nothing drew it.
 *
 * Sized and timed in BOARD units, like everything else the world camera renders: a cell is 64, so a
 * particle at scale 0.4 is a fifth of a cell across and the fastest fly about four cells a second —
 * quick enough to read as thrown, far slower than the disc that threw them (a full-power shot is 18
 * cells a second), so they trail the disc rather than racing it.
 */
const KNOCKOUT_PARTICLES = 12
const KNOCKOUT_PARTICLE_DEPTH = 40

/**
 * The gameplay scene.
 *
 * **State of play (GAME-PLAN.md §10):** S1 stood up the camera contract and the board, S2 built
 * the solver, S3 put discs on screen, S5 handed the gesture to the player, and S6 — this — gives the
 * round its rules: turns pass, penalties bite, and somebody wins.
 *
 * **The opponent is played by the same person.** There is no bot until S7, so the aim gate follows
 * `round.turn` rather than always being `'player'` — hot seat. That is not a placeholder for the
 * bot so much as the thing that makes S6 testable by hand: every flag in `game/rules.ts` can be
 * walked through from both sides. S7 replaces the opponent's half of it and nothing else.
 *
 * Still missing above this: the MATCH — best-of-N rounds, the result screen, saved progress. S9.
 *
 * Camera contract (CLAUDE.md "Responsive Layout"): `cameras.main` is the WORLD camera, zoomed onto
 * board space; `uiCamera` is always 1:1 with the viewport. Every object belongs to exactly one — an
 * object in neither camera's ignore list renders in BOTH. Disc sprites come and go every round, so
 * the split has to be re-applied whenever the set changes, which is what
 * {@link syncCameraMembership} is wired to.
 */
export class Game extends Phaser.Scene {
  private rules!: RuleSet
  private board!: BoardView
  private discView!: DiscView
  private aimView!: AimView
  private background!: Phaser.GameObjects.Image
  private uiCamera!: Phaser.Cameras.Scene2D.Camera

  /**
   * Where the world camera is pointing, in board space.
   *
   * Kept here rather than read back from `Camera.midPoint`, which Phaser only refreshes during
   * preRender — asking for it at the moment a gesture starts returns the previous frame's value.
   */
  private focus = { x: 0, y: 0 }
  /** The aim pull-back / return animation, so a second gesture cannot fight the first one's tail. */
  private cameraTween?: Phaser.Tweens.Tween

  /** One emitter for the whole round, fired by hand — see {@link burstKnockouts}. */
  private knockParticles!: Phaser.GameObjects.Particles.ParticleEmitter
  /**
   * The equipped particle wardrobe, and the two emitters it may add.
   *
   * Read ONCE in `create()` rather than per shot: an emitter's config is fixed when it is built, and
   * a match is one visit to this scene. Changing the set in the shop and coming back rebuilds the
   * scene, which is what makes that safe — see `Shop`'s return trip.
   *
   * Both are `undefined` for a set that does not decorate that moment. A set that lit every moment
   * identically would be the same set in a different tint, so which ones it touches is part of what
   * distinguishes it (`game/skins.ts`).
   */
  private effects!: EffectSet
  private impactParticles?: Phaser.GameObjects.Particles.ParticleEmitter
  private trailParticles?: Phaser.GameObjects.Particles.ParticleEmitter
  /** Milliseconds since the last trail puff. The trail is time-based, not frame-based: a 144Hz
   * screen must not lay down twice the trail of a 72Hz one. */
  private trailElapsed = 0
  /** How many of this shot's knock-offs have already been given a burst. Same drain-a-growing-list
   * shape as {@link soundedImpacts}, and for the same reason: the outcome accumulates DURING the
   * shot, so replaying it at the end would put every burst on the frame the board went still. */
  private burstKnockoffs = 0

  /** The disc currently held by an aim gesture, or `null` when nothing is being aimed. */
  private aiming: Disc | null = null

  private sim!: SimState
  private simConfig!: SimConfig
  private stepper!: Stepper
  /** Collects what the shot currently in flight does, as it happens. `null` between shots — read by
   * {@link settleShot} the moment the board stops. */
  private shotOutcome: SimOutcome | null = null

  private round!: RoundState
  /** How the last shot changed the turn, for the HUD to explain itself. */
  private lastResolution: ShotResolution | null = null

  /** Best-of-five, one round per branch of arms (§3, §4). Owns the score, the standing and who
   * opens; `game/round.ts` owns everything inside a round. */
  private match!: MatchState
  private hazards!: Hazards
  /** The board as it stood when the current shot was fired — §5's trick points are statements about
   * the transition, so scoring needs both ends of it. */
  private boardBeforeShot: SimState | null = null
  /** Impacts already sounded, so `update()` can play each one once as it happens rather than all of
   * them at the end. */
  private soundedImpacts = 0
  /** Milliseconds of §5's slow-motion finish left to run; `0` when the world is at normal speed. */
  private slowMotionUntil = 0
  /**
   * How fast the SOLVER runs relative to real time.
   *
   * Separate from Phaser's own `time.timeScale` and `tweens.timeScale`, because the solver is not
   * driven by either — `advance()` is handed a delta directly, so slowing it down means scaling that
   * delta. Slowing the tweens without this would stretch the falling-disc animation while the discs
   * still on the board carried on at full speed.
   */
  private simTimeScale = 1

  /** The character being played against, chosen in `Modes` and read once in `create()` — so a
   * change lands on the next match started from the menu and never mid-round. */
  private opponent!: Opponent
  /** Two people at one board. Set from {@link GameData} on a new match and from the saved record on
   * a resume, so a continued hot-seat match does not silently grow a bot. */
  private twoPlayer = false
  private botLevel!: BotLevel
  /** Its rate limit and line rotation, reset per match. */
  private speech!: SpeechDirector
  /** The HUD line it types into, and the voice quantised to that typing. */
  private speechLine!: SpeechLine
  private speechText!: Phaser.GameObjects.Text
  /**
   * **Who you are playing, on screen while you play them.**
   *
   * It was only ever visible on the picker, which is the one screen where the choice has already
   * been made — so the lines in the HUD arrived from nobody, and the ladder the whole cast exists
   * for was invisible during the only part of the game that advances it. It reacts as well as
   * speaks: see `ui/portrait.ts`'s `reactPortrait` and `say()`.
   */
  private portrait!: Phaser.GameObjects.Image
  private opponentVoice: DialogueVoiceManager | null = null
  private botRandom!: Random
  /** The bot's search in progress, spread across frames. `null` when it is not the bot's move. */
  private botSearch: BotSearch | null = null
  private thinkingElapsed = 0
  /** Last `isMoving` seen by `update()`, so the turn light is redrawn on the transition rather than
   * every frame. Set in `create()` too — a scene instance is reused across restarts. */
  private wasMoving = false
  /** Milliseconds left on §5's shot clock. Ignored entirely when `rules.shotClockMs` is 0, which is
   * every set except blitz. */
  private shotClockLeft = 0

  private topBar!: TopBar
  private statusText!: Phaser.GameObjects.Text
  private statusPlate!: Phaser.GameObjects.Graphics
  private discCounter!: DiscCounter
  private debugText?: Phaser.GameObjects.Text

  /** §8's two consumables, bought from the HUD because both only mean anything with a live round in
   * front of the player. */
  private retakeButton!: GameButton
  private powerButton!: GameButton
  /**
   * The board and the round as they stood before the last player shot, for the retake.
   *
   * A retake has to restore BOTH. Putting the discs back without the round would hand the player a
   * shot they had already spent, or leave a penalty standing for a shot that no longer happened.
   */
  private undoPoint: { board: SimState; round: RoundState } | null = null
  /** §8's retake is once per round — otherwise a full purse is a licence to brute-force the board. */
  private retakeUsed = false
  /** A bought power shot, waiting to be spent on the next release. */
  private powerArmed = false

  private viewportW = 0
  private viewportH = 0
  private fit!: BoardFit
  /** Recomputed every `layout()`: which strips the HUD lives in flips with the orientation. */
  private bands!: HudBands
  /**
   * The landscape side panel, and the two blocks that sandwich it.
   *
   * Modelled on `../Checkers`' own panel — see `ui/gamePanel.ts` — MINUS its move list, which this
   * game has nothing to put in. They are built unconditionally and hidden when
   * {@link SidePanelFit.mode} is `'bands'`: a portrait phone has no room for a column beside a board
   * that already fills the width, and building them lazily would mean a `create()` that depends on
   * the orientation the game happened to start in.
   */
  private panelFit!: SidePanelFit
  private sidePanel!: GamePanel
  private opponentBlock!: PlayerBlock
  private playerBlock!: PlayerBlock
  /** The player has no portrait — the cast is the opponent's alone — so their block's avatar slot
   * holds one of their own discs. */
  private playerAvatar!: Phaser.GameObjects.Image
  private shopButton!: GameButton
  private leaveButton!: GameButton

  constructor() {
    super('Game')
  }

  create(data: GameData = {}) {
    this.rules = getRuleSet(currentRulesId())
    this.twoPlayer = data.twoPlayer === true
    // Built either way, and deliberately: a hot-seat match still needs SOMETHING in the field that
    // holds a character, and gating construction here would put an `if` in front of every use of it
    // instead of in front of the four places that actually matter (the bot, the voice, the face and
    // the awards). Nothing it builds is drawn or spoken while `twoPlayer` is set.
    this.opponent = currentOpponent()
    this.botLevel = personaLevel(this.opponent)
    this.speech = speechDirector(this.opponent)
    this.opponentVoice = null
    // The solver is deterministic by rule; the bot's hand-shake is the one place randomness enters
    // the game, and it is seeded so a session can be reproduced from its log if a move ever looks
    // wrong. `Date.now()` is fine HERE — the ban on clocks is `src/sim/`'s, not the scene's.
    const seed = Date.now() >>> 0
    this.botRandom = createRandom(seed)
    if (import.meta.env.DEV) console.debug(`[bot] ${this.opponent.id}, seed ${seed}`)

    // The blurred scene behind the board, in the equipped set's colours. It belongs to the WORLD
    // camera, not the UI one: the UI camera composites on top of the world camera, so a background
    // there would cover the board instead of sitting behind it.
    this.background = this.add.image(0, 0, backgroundKey(boardSet(activeBoardSet()).background)).setOrigin(0.5).setDepth(-1000)

    // §5's board modifiers, built from the rule set and baked straight into the board. Empty for
    // every set that is not about them, so "the classic is untouched by any flag" is true by
    // construction rather than by care.
    this.hazards = hazardsFor(this.rules, createBoardMetrics(BOARD_SIZE))
    this.board = createBoardView(this, BOARD_SIZE, this.hazards, activeBoardSet())

    // The solver's view of the round. Two rule flags are physics questions rather than bookkeeping
    // ones — the bouncing rim and the pits — so they are the only ones that cross into `SimConfig`.
    this.simConfig = createSimConfig(this.board.metrics, {
      bumperRim: this.rules.bumperRim,
      pits: this.hazards.pits,
    })
    this.stepper = createStepper()
    this.discView = createDiscView(this, () => this.syncCameraMembership(), { pieces: activePieceSet() })
    this.aimView = createAimView(this)

    // Emitting is off: this fires by hand, once per disc that leaves the board.
    this.effects = effectSet(activeEffectSet())
    this.knockParticles = this.makeEmitter(this.effects.knock).setDepth(KNOCKOUT_PARTICLE_DEPTH)
    this.impactParticles = this.effects.impact ? this.makeEmitter(this.effects.impact).setDepth(KNOCKOUT_PARTICLE_DEPTH - 1) : undefined
    this.trailParticles = this.effects.trail ? this.makeEmitter(this.effects.trail).setDepth(KNOCKOUT_PARTICLE_DEPTH - 2) : undefined

    // The top bar carries the round indicator here and nowhere else — `2 / 5` is meaningless on a
    // menu. Back does NOT leave the match outright: see `requestLeave`.
    this.topBar = createTopBar(this, {
      back: true,
      round: true,
      onBack: () => this.requestLeave(),
      onSettings: () => {
        this.scene.pause()
        this.scene.launch('Settings', { opener: 'Game' })
      },
    })
    this.topBar.setCoins(coinBalance())

    // The one HUD element that answers "who is winning", which a round has no other way
    // of saying — see `ui/discCounter.ts`.
    this.discCounter = createDiscCounter(this, this.rules.piecesPerSide, activePieceSet())

    this.statusPlate = this.add.graphics()
    this.statusText = this.add
      .text(0, 0, t('yourShot'), { fontFamily: getDisplayFontStack(), fontSize: STATUS_FONT_SIZE, color: '#e6d8f5', align: 'center' })
      .setOrigin(0.5)

    // The opponent's line, in the HUD band and never over the board — every pixel of the board is a
    // drag surface for aiming, so a floating bubble would sit on top of the one thing the player is
    // about to gesture across. Plain Arial rather than the display face: this is a voice talking, and
    // the display face is the game's own furniture.
    this.speechText = this.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: SPEECH_FONT_SIZE, color: SPEECH_COLOR, align: 'center' })
      // Anchored by its TOP edge, not its centre, and that is the whole of a shipped bug rather
      // than a preference. The line types itself in one character at a time, so its height grows
      // from nothing to two lines DURING the reveal — and a centred object grows in both
      // directions, which walked the first line up into the status capsule above it while the row
      // reserved for it below sat empty. Anchored by the top it can only grow down, into the room
      // that was set aside for exactly that.
      .setOrigin(0.5, 0)
      .setVisible(false)
    this.speechLine = speechLine(this, this.speechText)

    // Beside the status capsule rather than over the board — same reason the line is: every pixel of
    // the board is a drag surface for aiming.
    this.portrait = makePortrait(this, this.opponent.id, HUD_PORTRAIT_HEIGHT)
    // Two people at one board have no third face to look at. Hidden rather than skipped, so the
    // HUD's layout arithmetic is unchanged and `say()`'s one gate is the only special case.
    this.portrait.setVisible(this.isSolo())

    // Icon and price, which is the whole proposition and needs no translation. §8: bought where they
    // are used rather than from a menu — a retake that costs a trip to the shop mid-round is a
    // retake nobody uses. One token for both, so the pair reads as a pair.
    // The mark is an ATLAS FRAME beside the price, not a glyph inside the label: these were
    // `U+21A9` and `U+1F4A5`, and a character is drawn only if the device owns it — see
    // `assets.ts`'s `ATLAS_FRAMES`.
    this.retakeButton = gameButton(this, { size: 'compact', variant: 'plum', iconFrame: ATLAS_FRAMES.retake, label: String(RETAKE_ITEM.priceCoins) })
    this.powerButton = gameButton(this, { size: 'compact', variant: 'plum', iconFrame: ATLAS_FRAMES.power, label: String(POWER_SHOT_ITEM.priceCoins) })
    bindAction(this, 'buyRetake', { pointer: this.retakeButton.hitArea }, () => this.buyRetake())
    bindAction(this, 'buyPowerShot', { pointer: this.powerButton.hitArea }, () => this.buyPowerShot())

    /**
     * The side panel's second row: the shop, and the way out.
     *
     * Panel-only, like everything else in it. §8's rule that consumables are bought where they are
     * USED still holds and is why the two above exist at all — this is a door to the wardrobe, not a
     * second way to buy a retake.
     *
     * **The shop is a NAV destination here, not an overlay**, so this leaves the board. That is safe
     * for exactly one reason and it is worth knowing: the match is persisted after every settled
     * shot, and the trip pushes `{ resume: true }` onto the nav stack so the back button brings the
     * board back rather than starting a fresh match over the top of it. Before `navTo` learned to
     * carry return data, that same button would have discarded the match it left.
     */
    this.shopButton = gameButton(this, { size: 'compact', variant: 'plum', label: t('shop') })
    this.leaveButton = gameButton(this, { size: 'compact', variant: 'ghost', label: t('leaveMatch') })
    bindAction(this, 'panelShop', { pointer: this.shopButton.hitArea }, () => this.openShop())
    bindAction(this, 'panelLeave', { pointer: this.leaveButton.hitArea }, () => this.requestLeave())

    this.sidePanel = createGamePanel(this)
    this.opponentBlock = createPlayerBlock(this)
    this.playerBlock = createPlayerBlock(this)
    // The player has no face in this game, so their block wears one of their own discs. `'none'`
    // is the unmarked variant: the branch's emblem belongs on the board, and a mark shrunk into a
    // 50px avatar is a smudge rather than a badge.
    ensureDiscTextures(this, pieceSet(activePieceSet()), 'none')
    const token = discTextureKey('player', activePieceSet(), 'none')
    this.playerAvatar = this.add.image(0, 0, this.textures.exists(token) ? token : '__DEFAULT').setOrigin(0.5).setVisible(false)

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    for (const object of [
      ...this.sidePanel.objects,
      ...this.opponentBlock.objects,
      ...this.playerBlock.objects,
      this.playerAvatar,
      this.shopButton.container,
      this.leaveButton.container,
      this.statusPlate,
      this.statusText,
      this.speechText,
      this.portrait,
      ...this.discCounter.objects,
      ...this.topBar.objects,
      this.retakeButton.container,
      this.powerButton.container,
    ]) {
      this.cameras.main.ignore(object)
    }

    // `import.meta.env.DEV &&` rather than a null check alone, so the body and its string literals
    // are dead-code-eliminated from the production bundle rather than merely unreachable.
    if (import.meta.env.DEV) {
      this.debugText = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: DEBUG_FONT_SIZE, color: '#ffffff' }).setOrigin(0, 0)
      this.cameras.main.ignore(this.debugText)
    }

    this.syncCameraMembership()

    // The whole board is one drag surface, and the gate that makes a press mean "aim" rather than
    // nothing is `discAt()` inside `beginAim` — §2's trap 4.
    bindDrag(this, 'aim', this.board.hitTarget, {
      onStart: (pointer) => this.beginAim(pointer),
      onMove: (pointer) => this.updateAim(pointer),
      onEnd: (pointer) => this.releaseAim(pointer),
      onCancel: () => this.cancelAim(),
    })
    bindAction(this, 'leaveMatch', { keys: ['BACKSPACE'] }, () => this.leave())

    bindLayout(this, (width, height) => this.layout(width, height))
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.silenceOpponent())

    // Resume the match in the save if it belongs to this rule set, otherwise start a fresh one —
    // the reason the save stores the whole board is in `game/persistence.ts`.
    const resumed = data.resume ? loadMatch(this.rules.id) : null
    if (resumed) {
      this.match = resumed.match
      this.round = resumed.round
      // **The record decides, not the button that got here.** `MainMenu`'s Continue knows there is a
      // saved match and nothing about what kind, so taking the flag from `data` would hand a
      // half-finished hot-seat match to the bot — or leave a solo match with no opponent at all.
      this.twoPlayer = resumed.twoPlayer
      // **A saved board with one side already wiped out starts the NEXT round instead of being
      // adopted** — see `savedRoundIsOver` for the whole of why, and why the recovery is the next
      // round rather than dropping the match.
      const settled = savedRoundIsOver(resumed.board)
      if (settled) this.startRound(this.match.first)
      else this.adoptBoard(resumed.board)
      if (import.meta.env.DEV) {
        console.debug(
          `[match] resumed round ${roundNumber(this.match)}, ${this.match.wins.player}-${this.match.wins.opponent}` +
            (settled ? ' (saved board was a finished round — started the next one)' : ''),
        )
      }
    } else {
      this.match = createMatch(this.rules.id)
      clearMatch()
      this.startRound(this.match.first)
    }

    /**
     * The match half of the guided tour, the first time a board opens (`game/tour.ts`).
     *
     * LAST in `create()`, because every step here is a screen rectangle and the discs have to be on
     * the board before the camera can be asked where the board is. `delayedCall(0)` for the reason
     * `MainMenu` uses one — pausing a scene from inside its own `create()` queues an operation
     * against the one that started it.
     *
     * Nothing is interrupted by pausing here, whoever shoots first: the bot's search is pumped from
     * `update()`, which a paused scene does not run, so it simply has not started. A tour that
     * opened over a thinking bot would be a tour with a frozen "Thinking…" behind it.
     */
    if (shouldRunTour('match')) this.time.delayedCall(0, () => this.openTour())
  }

  private openTour(): void {
    // The opponent's greeting is typing itself out as this opens, and a line revealing itself
    // behind a scrim finishes unread with the voice still going.
    this.silenceOpponent()
    this.scene.pause()
    this.scene.launch('Coach', { opener: 'Game', chapter: 'match' })
  }

  /**
   * What the tour points at on a board.
   *
   * The BOARD's rectangle is converted out of world space HERE rather than stored by `layout()`:
   * this scene's main camera is zoomed onto board space, so the board's own coordinates are not
   * screen coordinates and only the camera knows the current fit. Everything else on this screen is
   * drawn by `uiCamera` at 1:1, so its bounds are already screen px.
   *
   * The two HUD shapes are covered by asking for BOTH and letting the coach drop whichever is not
   * there: the status capsule is hidden in the side panel's layout and the opponent's block is
   * hidden in the strip's, so exactly one of those two steps survives on any given screen. That is
   * the whole reason `Coach` drops a step whose target has no size — this list needs no branch per
   * layout, and neither will the next one added to it.
   */
  tourSteps(): CoachStep[] {
    // A zero box and NOT `null`: `null` is a legitimate step ABOUT THE WHOLE SCREEN, so it would add
    // a second copy of a step rather than dropping one.
    const ZERO_RECT = { x: 0, y: 0, width: 0, height: 0 }
    const camera = this.cameras.main
    /**
     * ONE OF THE PLAYER'S OWN DISCS, not the whole board — and that is a geometry decision as much
     * as a teaching one.
     *
     * A square board fits the viewport's shorter side, so in portrait the spotlight would be a
     * 390-unit hole in a 844-tall screen with ~230 units of band above it and a card taller than
     * that: the coach's last-resort placement then draws the card over the ring, which is the one
     * thing it exists not to do. Ringing a disc leaves the whole band free — and it is also the more
     * honest picture, since what the step says is "press one of YOUR OWN discs" and the ring is then
     * around exactly that. Seen in a screenshot of the real thing, not deduced.
     */
    const own = liveDiscs(this.sim).filter((disc) => disc.side === this.humanSide())
    const middle = own[Math.floor(own.length / 2)]
    const toScreen = (x: number, y: number, r: number) => ({
      x: (x - r - camera.worldView.x) * camera.zoom,
      y: (y - r - camera.worldView.y) * camera.zoom,
      width: r * 2 * camera.zoom,
      height: r * 2 * camera.zoom,
    })
    const board = middle ? toScreen(middle.x, middle.y, middle.r) : ZERO_RECT
    /** A hidden object reports a ZERO box rather than where it would be if it were shown. */
    const boxOf = (object: Phaser.GameObjects.Text | Phaser.GameObjects.Container): CoachStep['target'] => {
      if (!object.visible) return ZERO_RECT
      const bounds = object.getBounds()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    }

    return [
      { target: board, title: 'coachBoardTitle', body: 'coachBoardBody' },
      // No target: "a disc that crosses the edge is gone" is a rule about the whole board, and
      // ringing one square would say it is about that square.
      { target: null, title: 'coachEdgeTitle', body: 'coachEdgeBody' },
      { target: boxOf(this.statusText), title: 'coachTurnTitle', body: 'coachTurnBody' },
      // Gated on the panel EXISTING rather than on the block's own box, which keeps whatever the
      // last panelled layout put in it: a phone rotated from landscape to portrait would otherwise
      // report both this step and the capsule's, and the player would be told whose shot it is twice.
      { target: this.panelFit?.panel ? this.opponentBlock.box : ZERO_RECT, title: 'coachTurnTitle', body: 'coachTurnBody' },
      { target: boxOf(this.retakeButton.container), title: 'coachRetakeTitle', body: 'coachRetakeBody' },
      { target: boxOf(this.powerButton.container), title: 'coachPowerTitle', body: 'coachPowerBody' },
    ]
  }

  /** The branch of arms this round is fought with (§4). */
  private get formation(): FormationId {
    return currentFormation(this.match)
  }

  /**
   * Sets the board up for a fresh round, with `first` to shoot.
   *
   * Everything derived from the round is rebuilt rather than patched: a half-reset is how a stale
   * `aiming` reference to a disc that no longer exists gets to draw an aim line over the new board.
   */
  private startRound(first: Side): void {
    this.wasMoving = false
    // Rebuilt per round rather than reused: which silhouette a stack wears is a property of the
    // BRANCH, and the branch changes every round (§4).
    this.discView.destroy()
    this.discView = createDiscView(this, () => this.syncCameraMembership(), { stackTop: BRANCH_PROFILES[this.formation].top, mark: BRANCH_PROFILES[this.formation].mark, pieces: activePieceSet() })

    this.round = createRound(first)
    // The rotation and the cooldown are per ROUND, like the consumables below: a character that
    // carried its cursor across five rounds would open round two on the line it opened round one
    // with, and its "hello" would be rate-limited by a shot fired in the previous round.
    this.speech.reset()
    this.speechLine.hide()
    this.say('onMatchStart', 'calm')
    // §8's retake is once per ROUND, so both consumables reset here rather than per match.
    this.retakeUsed = false
    this.powerArmed = false
    this.undoPoint = null
    this.adoptBoard(
      createState(buildFormation(this.formation, this.board.metrics, { piecesPerSide: this.rules.piecesPerSide, advance: this.match.advance })),
    )
  }

  /** Installs a board — freshly built or restored from a save — and clears everything derived from
   * the previous one. A half-reset is how a stale `aiming` reference to a disc that no longer exists
   * gets to draw an aim line over the new board. */
  private adoptBoard(board: SimState): void {
    this.sim = board
    this.lastResolution = null
    this.shotOutcome = null
    this.boardBeforeShot = null
    this.soundedImpacts = 0
    this.burstKnockoffs = 0
    this.aiming = null
    this.shotClockLeft = this.rules.shotClockMs
    this.stopThinking()
    resetStepper(this.stepper)
    this.aimView.hide()
    // The board is at rest, so alpha is 1: what is drawn is exactly where the solver says the discs
    // are. See `discView.draw`'s own note on why that matters.
    this.discView.reset(this.sim)
    this.syncCameraMembership()
    this.refreshStatus()
    this.persist()
  }

  /** Writes the match, the round and the board to the save. Called between shots, never during
   * one — see `game/persistence.ts`'s `saveMatch`. */
  private persist(): void {
    if (this.match.winner) return
    saveMatch(this.match, this.round, this.sim, this.twoPlayer)
  }

  private leave(): void {
    this.persist()
    this.scene.start('MainMenu')
  }

  /**
   * Re-applies the world/UI split over the CURRENT object set.
   *
   * Called whenever `discView` creates or retires a sprite. `Camera.ignore()` sets a bit on the
   * object rather than appending to a list, so calling it again for objects already ignored is free
   * and idempotent — which is what lets this be a blunt "re-apply everything" rather than a diff.
   */
  /**
   * Back, from inside a match.
   *
   * Never leaves outright. A round is ten to twenty shots of accumulated position and the back
   * button lives in the corner a thumb rests on; one stray tap discarding all of it is a far worse
   * outcome than one extra confirmation. The match is saved after every settled shot anyway
   * (`game/persistence.ts`), so confirming loses nothing — but the player does not know that, and
   * the dialog is where they find out they can come back.
   */
  /** Leaves for the wardrobe, having written the board down first. See the buttons' own note for
   * why a nav trip is safe here and was not before. */
  private openShop(): void {
    this.persist()
    navTo(this, 'Shop', undefined, { resume: true })
  }

  private requestLeave(): void {
    this.scene.pause()
    this.scene.launch('Confirm', { opener: 'Game', ...leaveConfirm(t('leaveMatchAsk'), t('leaveMatch'), () => this.leave()) })
  }

  /**
   * Silences the opponent when the scene goes away.
   *
   * **`speechLine.stop()`, never `hide()`**, and that distinction is load-bearing: Phaser's
   * `DisplayList` registers its own `SHUTDOWN` listener when the scene boots — before anything
   * `create()` registers — and destroys every game object in the scene. By the time this runs, the
   * `Text` is already destroyed, and `setText()` on a destroyed `Text` throws from inside the
   * shutdown handler and takes the whole game down with it. See {@link SpeechLine.stop}.
   *
   * The voice needs stopping for a different reason: it lives on the sound manager, not on the
   * scene, so nothing would ever have cut it — a character would go on burbling over the menu.
   */
  private silenceOpponent(): void {
    this.speechLine.stop()
    this.opponentVoice?.stop()
    this.opponentVoice = null
  }

  /**
   * One emitter, built from one {@link EffectBurst}.
   *
   * The blend mode is the part worth reading: `particle-shard` carries the same thick dark contour
   * every sprite in this game does, and at a fifth of a cell that contour is most of the shape — so
   * under normal blending a shard burst reads as dirt scattered on the board rather than as
   * something thrown off. Additive drops the near-black to nothing and leaves the lit core. A set
   * that wants MASS instead of light turns it off and pays for it by using a frame with less contour.
   * Canvas maps ADD to `lighter`, so the fallback renderer agrees.
   */
  private makeEmitter(burst: EffectBurst): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.add.particles(0, 0, ATLAS_KEY, {
      frame: [...burst.frames],
      lifespan: { min: burst.life.min, max: burst.life.max },
      speed: { min: burst.speed.min, max: burst.speed.max },
      scale: { start: burst.scale, end: 0 },
      alpha: { start: 1, end: 0 },
      rotate: { min: -180, max: 180 },
      gravityY: burst.gravityY,
      blendMode: burst.additive ? 'ADD' : 'NORMAL',
      emitting: false,
    })
  }

  private syncCameraMembership(): void {
    // An object in NEITHER camera's ignore list renders in BOTH — see the class comment. The
    // emitter is world content, so the UI camera must be told to skip it.
    this.uiCamera.ignore([
      this.background,
      this.knockParticles,
      ...(this.impactParticles ? [this.impactParticles] : []),
      ...(this.trailParticles ? [this.trailParticles] : []),
      ...this.board.worldObjects,
      ...this.discView.worldObjects,
      ...this.aimView.worldObjects,
    ])
  }

  /** Board-space position of a pointer. The world camera's zoom is inverted by Phaser, so this is
   * the same space the solver works in and no scaling is done by hand anywhere. */
  private worldPoint(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    return this.cameras.main.getWorldPoint(pointer.x, pointer.y)
  }

  /**
   * The side a person is allowed to shoot for right now.
   *
   * One function rather than a `twoPlayer` test at each of the six gates, because the gates have to
   * agree: an aim that starts on a disc the shot clock is not counting for, or a consumable offered
   * to a side whose turn it is not, is a state nobody thinks to test.
   */
  private humanSide(): Side {
    return this.twoPlayer ? this.round.turn : PLAYER_SIDE
  }

  /** A match against a character, with everything that hangs off having one: the bot, the voice, the
   * face, the coins, the leaderboard, the ladder and the consumables. */
  private isSolo(): boolean {
    return !this.twoPlayer
  }

  /**
   * The gate (GAME-PLAN.md §2, trap 4): a press only begins an aim if it landed on one of the
   * PLAYER's live discs, it is the player's turn, the board is still, and the round is not over.
   *
   * S6 gated on `round.turn` so one person could play both sides; S7 made the opponent a bot, and
   * gating on the player's side is what stops the human from taking its shots for it. **In two-player
   * mode the S6 rule is exactly what is wanted again**, so the side the gate asks about is the side
   * whose turn it is — which in a solo match is only ever the player's.
   *
   * Refusing is the normal case — most presses on a board are not the start of a shot — so it is
   * silent. Returning `false` here means `bindDrag` ignores the rest of the gesture entirely.
   */
  private beginAim(pointer: Phaser.Input.Pointer): boolean {
    if (this.round.winner) return false
    if (this.round.turn !== this.humanSide()) return false
    // Aiming into a board that is still settling would be aiming at positions that no longer exist
    // by the time the shot lands.
    if (isMoving(this.sim)) return false

    const world = this.worldPoint(pointer)
    const disc = discAt(this.sim, world.x, world.y, this.humanSide())
    if (!disc) return false

    this.aiming = disc
    this.enterAimCamera()
    this.paintAim(world.x, world.y)
    return true
  }

  /**
   * Pulls the camera back so the slingshot has somewhere to be pulled TO.
   *
   * The board binds to the viewport's shorter side with an 8px margin, so on that axis there is no
   * room outside the rim — and a pull needs 2.5 cells of it. Measured before this existed: a disc on
   * the rim could reach 100% power on one axis and **23-27% on the other**, in every viewport, which
   * meant the same length of drag was a different shot depending on which way you pulled. That is
   * precisely the property `MAX_DRAG_CELLS` is measured in board cells to guarantee.
   *
   * **Zoomed about the board's centre, and the first attempt got this exactly backwards.** Keeping
   * the pressed disc pinned under the finger looks like the considerate thing to do, and it destroys
   * the apron it is supposed to create: if the disc does not move, the gap between it and the screen
   * edge does not grow either, while `MAX_DRAG` in screen pixels shrinks with the zoom. Measured, a
   * rim disc went from 23% of full power to 22% — the change did nothing. Zooming about the board's
   * centre is what walks the disc away from the edge, which is the whole point.
   *
   * Nothing about the aim itself moves: the pull is `pointer - disc` in WORLD space, and the camera
   * appears in neither term. All the zoom changes is how much screen there is to pull across.
   *
   * Temporary by design — the board is full size at rest, and only gives up room while a gesture is
   * actually asking for it. `layout()` re-applies whichever of the two states is current, so a
   * resize mid-aim does not snap the board back and strand the drag.
   */
  /**
   * What the world camera centres on at a given zoom.
   *
   * **The panel shift is a screen-px offset and therefore depends on the zoom**, which is the whole
   * reason this is a function of it: to move the board `d` screen px left, the camera centres `d /
   * zoom` world units right. `applyCamera` had this and the two aim-camera moves did not — they
   * centred on the bare `boardW / 2`, so pressing a disc slid the board sideways under the panel
   * (the far rank's last disc was drawn UNDER it, and it is a disc you may want to shoot at) and
   * left the background plate, which was still placed at the shifted centre, short of the viewport
   * by 120 world units. That gap was bare canvas: measured at `#3d1160` down the left edge.
   */
  private focusFor(zoom: number): number {
    return this.board.metrics.boardW / 2 - this.centreShift() / zoom
  }

  private enterAimCamera(): void {
    const target = computeAimZoom(this.board.metrics, this.viewportW, this.viewportH)
    if (target >= this.fit.zoom) return
    this.moveCamera(target, this.focusFor(target), this.board.metrics.boardH / 2)
  }

  /** Back to the resting fit. Called from every ending the gesture has — fired, cancelled, or
   * interrupted — because a camera left zoomed out is a board that never comes back. */
  private leaveAimCamera(): void {
    if (this.cameras.main.zoom === this.fit.zoom) return
    this.moveCamera(this.fit.zoom, this.focusFor(this.fit.zoom), this.board.metrics.boardH / 2)
  }

  /**
   * Eases the world camera to a zoom and a focus point.
   *
   * Hand-tweened rather than `Camera.zoomTo()`, so that {@link focus} is written by the same code
   * that moves the camera and cannot drift from it. `Camera.midPoint` is not a substitute — like
   * `worldView` (see {@link applyCamera}) Phaser only refreshes it during preRender, so asking for
   * it at the instant a gesture starts hands back the previous frame's value.
   */
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

  /** The one place the world camera's zoom and focus are written, so {@link focus} cannot drift out
   * of step with where the camera actually points. */
  private setCamera(zoom: number, focusX: number, focusY: number): void {
    this.focus.x = focusX
    this.focus.y = focusY
    this.cameras.main.setZoom(zoom)
    this.cameras.main.centerOn(focusX, focusY)
  }

  private updateAim(pointer: Phaser.Input.Pointer): void {
    if (!this.aiming) return
    const world = this.worldPoint(pointer)
    this.paintAim(world.x, world.y)
  }

  /**
   * Finger lifted: fire, or cancel.
   *
   * §3's cancel is not a special case handled here — it falls out of the same `computeAim` the whole
   * gesture is drawn from. Pull the finger back toward the disc and the power drops below the
   * threshold, at which point releasing does nothing. One rule, visible the entire time it applies.
   */
  private releaseAim(pointer: Phaser.Input.Pointer): void {
    const shooter = this.aiming
    this.aiming = null
    this.aimView.hide()
    this.leaveAimCamera()
    if (!shooter) return

    const world = this.worldPoint(pointer)
    const aim = computeAim(shooter, world.x, world.y)
    if (aim.cancelled) return

    this.fire(shooter.id, aim.angle, aim.power)
  }

  /**
   * Sets a shot going. The single path both the player's release and the bot's decision take, so
   * neither can drift from the other in what it sets up.
   *
   * The shot is simulated ONCE, live, in `update()` — not resolved up front and then replayed.
   * `advance()` accumulates into `shotOutcome` as the steps happen, so by the time the board is
   * still it holds everything the round logic and the HUD need without the shot having been run
   * twice. `runToRest` stays the right call for the bot's own search and the puzzle generator, which
   * want the answer with no frames drawn at all.
   */
  private fire(discId: number, angle: number, power: number): void {
    const disc = this.sim.discs.find((candidate) => candidate.id === discId)
    if (!disc || !disc.alive) return

    resetStepper(this.stepper)
    // Kept for the length of the shot: §5's trick points are statements about the TRANSITION ("left
    // every one of your own on the board", "was your last disc"), which neither end of it can answer
    // alone.
    this.boardBeforeShot = cloneState(this.sim)
    // And kept past it, for §8's retake — which needs the round as well as the board.
    if (disc.side === PLAYER_SIDE) this.undoPoint = { board: cloneState(this.sim), round: cloneRound(this.round) }

    this.shotOutcome = createOutcome(disc.id, disc.side)
    this.soundedImpacts = 0
    this.burstKnockoffs = 0

    // §8's power shot raises the ceiling for this shot only, and is spent whether or not it helped.
    const ceiling = this.powerArmed ? this.simConfig.maxSpeed * POWER_SHOT_MULTIPLIER : this.simConfig.maxSpeed
    this.powerArmed = false
    applyImpulse(disc, angle, power, ceiling, this.simConfig.powerCurve)

    // The flick itself — the direct answer to the action. The impacts that follow are sounded as
    // they happen, in `soundImpacts()`.
    playSfx(SFX.move, { rate: 0.94 + power * 0.16 })
    this.refreshActions()
  }

  /**
   * A puff behind every disc that is still moving.
   *
   * **Timed, not per frame.** A trail laid down once per `update()` would be twice as dense on a
   * 144Hz screen as on a 72Hz one — the same class of mistake §2's trap 3 describes for drawing the
   * solver's raw position, and the same fix: accumulate real milliseconds and act on them.
   *
   * It follows the SOLVER's position rather than the interpolated render one. The difference is a
   * fraction of a step and the trail is a smear of translucent sprites, so paying for the
   * interpolation here would buy nothing the eye can find.
   *
   * **On record: this is the one effect in the wardrobe with a case against it.** §8's rule is that
   * nothing purchasable may answer the question the game is asking, and a trail shows where a disc
   * HAS been rather than where it will go — so it passes the letter of it. What it does do is make
   * friction legible, and friction is half of what a player is judging. It ships because it was
   * asked for after that was said out loud, not because the objection was answered.
   */
  private layTrail(delta: number): void {
    const trail = this.effects.trail
    if (!trail || !this.trailParticles) return

    this.trailElapsed += delta
    if (this.trailElapsed < trail.everyMs) return
    this.trailElapsed = 0

    const pieces = pieceSet(activePieceSet())
    for (const disc of this.sim.discs) {
      if (!disc.alive || (disc.vx === 0 && disc.vy === 0)) continue
      // Tinted from the disc's OWN side: a trail is attached to one disc, unlike a contact flash,
      // so it can say whose without any ambiguity about which of two it belongs to.
      this.trailParticles.setParticleTint(disc.side === PLAYER_SIDE ? pieces.player.mid : pieces.opponent.mid)
      this.trailParticles.emitParticleAt(disc.x, disc.y, trail.count)
    }
  }

  /**
   * Plays each new contact once, as it happens, with volume and pitch from its energy.
   *
   * §9 calls this the game's main sound and is emphatic about why a flat sample will not do: a weak
   * hit and a hard one sounding the same is the point at which the physics stops being felt. Driven
   * off the closing speed rather than the impulse, because impulse also scales with the masses
   * involved — a tank nudging something would be "loud" for the wrong reason.
   */
  private soundImpacts(outcome: SimOutcome): void {
    for (let i = this.soundedImpacts; i < outcome.impacts.length; i++) {
      const impact: Impact = outcome.impacts[i]
      if (impact.speed < IMPACT_SILENT_BELOW) continue

      const energy = Math.min(1, impact.speed / (MAX_SPEED * 1.2))
      /**
       * The flash scales with the SAME energy the sound does, and for the same reason §9 gives for
       * the sound: a weak hit and a hard one looking identical is where the physics stops being
       * felt. One knock-on: a contact involves two discs and this is drawn at the contact POINT, so
       * it is tinted from neither side — a burst there is about the collision, not about whose disc
       * won it. The knock-off burst is the one that has to say whose.
       */
      if (this.impactParticles && this.effects.impact) {
        const count = Math.max(1, Math.round(this.effects.impact.count * energy))
        this.impactParticles.emitParticleAt(impact.x, impact.y, count)
      }
      playSfx(SFX.capture, {
        volume: IMPACT_MIN_VOLUME + (IMPACT_MAX_VOLUME - IMPACT_MIN_VOLUME) * energy,
        rate: IMPACT_MIN_RATE + (IMPACT_MAX_RATE - IMPACT_MIN_RATE) * energy,
      })
    }
    this.soundedImpacts = outcome.impacts.length
  }

  /**
   * Throws a burst of sparks after each disc as it leaves the board.
   *
   * Fired as it happens rather than replayed when the board settles, for the same reason the impact
   * sounds are: a shot that takes three discs over four seconds should read as three separate
   * losses, not one shower at the end.
   *
   * Tinted with the losing side's own ramp, so the burst says WHOSE disc just went — which is the
   * one thing a player needs from it, and the one thing the fall animation alone does not say at a
   * glance when discs are leaving from opposite edges.
   *
   * The ramp's `mid` stop rather than `light`, and that is not a nicety: additive blending pushes a
   * light colour toward white against this board, so tinting with `light` produced a white burst on
   * both sides and threw away the very distinction the tint is for. `mid` still reads as gold or
   * violet once added.
   */
  private burstKnockouts(outcome: SimOutcome): void {
    const pieces = pieceSet(activePieceSet())
    for (let i = this.burstKnockoffs; i < outcome.knockedOff.length; i++) {
      const gone = outcome.knockedOff[i]
      // A pit swallows a disc rather than throwing it, so it gets a smaller, dimmer puff.
      // From the equipped set rather than a constant: a `dust` puff and a `coins` payout are not the
      // same number of things. A pit still gets half of whatever that is — it swallows a disc rather
      // than throwing it.
      const full = this.effects.knock.count
      const count = gone.edge === 'pit' ? Math.max(1, Math.round(full / 2)) : full
      this.knockParticles.setParticleTint(gone.side === PLAYER_SIDE ? pieces.player.mid : pieces.opponent.mid)
      this.knockParticles.emitParticleAt(gone.x, gone.y, count)
    }
    this.burstKnockoffs = outcome.knockedOff.length
  }

  /**
   * The bot's turn, one frame's worth.
   *
   * §6 requires the search to be sliced on a millisecond budget rather than run in one go: ~500
   * solver runs is about 100ms, which as a single blocking call is a visible freeze. Spread out it
   * becomes the pause a move needs anyway to read as a decision — which is why the thinking
   * indicator is not a fig leaf for the delay so much as the delay's purpose.
   */
  private think(delta: number): void {
    this.thinkingElapsed += delta

    if (!this.botSearch) {
      this.botSearch = createSearch({
        state: this.sim,
        side: BOT_SIDE,
        level: this.botLevel,
        // What this character is TRYING to do. `undefined` for a row that states no bias, which
        // `createSearch` reads as the default vector — so "plays the game straight" needs no entry.
        weights: this.opponent.persona.weights ? { ...DEFAULT_WEIGHTS, ...this.opponent.persona.weights } : undefined,
        // How it plays, as opposed to how well — see `bot/search.ts`'s `BotQuirks`. Also `undefined`
        // for a row that states no habit, which the search reads as the plain fan at every power.
        quirks: this.opponent.persona.quirks,
        config: this.simConfig,
        rules: this.rules,
        random: this.botRandom,
      })
    }

    if (!this.botSearch.step(BOT_FRAME_BUDGET_MS)) {
      this.refreshStatus()
      return
    }

    const shot = this.botSearch.shot()
    const progress = this.botSearch.progress
    this.botSearch = null
    this.thinkingElapsed = 0

    if (!shot) {
      // Nothing to aim at — the round is effectively over and the turn logic will say so on the next
      // resolution. Passing rather than stalling keeps the game moving either way.
      this.lastResolution = forfeitShot(this.round)
      this.refreshStatus()
      return
    }

    if (import.meta.env.DEV) console.debug(`[bot] ${this.botLevel.id} chose after ${progress.evaluated} candidates`)
    this.fire(shot.discId, shot.angle, shot.power)
  }

  /**
   * §8's retake: put the board and the round back to just before your last shot, once per round.
   *
   * Note what it does NOT do — it does not aim for you, and it does not tell you anything you did
   * not already learn by taking the shot. §8's rule for consumables is that neither may answer the
   * question the game is asking, and in a flick game that question is "can you aim this". A retake
   * gives back the shot, not the skill.
   */
  private buyRetake(): void {
    // **`isSolo()` and not just the dimming.** `refreshActions` drops these buttons to 0.4 alpha in
    // two-player mode, and alpha is a picture rather than a rule — the handler is still live, and on
    // player one's turn `round.turn === PLAYER_SIDE` holds, so without this the coins of whoever owns
    // the save would buy a retake for one of the two people sharing the device.
    if (this.twoPlayer) return
    if (this.retakeUsed || !this.undoPoint || this.round.winner) return
    if (isMoving(this.sim) || this.round.turn !== PLAYER_SIDE) return
    if (!spendOn(RETAKE_ITEM)) {
      this.flashStatus(t('notEnoughCoins'))
      return
    }

    this.retakeUsed = true
    this.round = this.undoPoint.round
    this.adoptBoard(this.undoPoint.board)
    this.undoPoint = null
    this.topBar.setCoins(coinBalance())
    this.refreshActions()
  }

  /** §8's power shot: a higher ceiling on the NEXT shot only. Where it goes is still entirely the
   * player's thumb, which is what keeps it honest. */
  private buyPowerShot(): void {
    // Same reason as the retake above: the dimming is a picture, this is the rule.
    if (this.twoPlayer) return
    if (this.powerArmed || this.round.winner) return
    if (isMoving(this.sim) || this.round.turn !== PLAYER_SIDE) return
    if (!spendOn(POWER_SHOT_ITEM)) {
      this.flashStatus(t('notEnoughCoins'))
      return
    }

    this.powerArmed = true
    this.topBar.setCoins(coinBalance())
    this.refreshActions()
  }

  /** Dims a consumable that cannot be used right now, so an unusable button reads as unusable rather
   * than as broken. */
  private refreshActions(): void {
    // Off entirely in two-player mode: both are bought with coins from a single wallet, and there
    // is no answer to whose wallet pays when both sides are people sharing a device.
    const usable = this.isSolo() && !this.round.winner && this.round.turn === PLAYER_SIDE && !isMoving(this.sim)
    this.retakeButton.container.setAlpha(usable && !this.retakeUsed && this.undoPoint ? 1 : 0.4)
    this.powerButton.container.setAlpha(usable && !this.powerArmed ? 1 : 0.4)
  }

  /** A one-off message on the status line, replaced by the next refresh. */
  private flashStatus(message: string): void {
    this.statusText.setText(message)
    this.layoutHud()
  }

  /** Drops any search in progress — the board it was reasoning about is gone. */
  private stopThinking(): void {
    this.botSearch = null
    this.thinkingElapsed = 0
  }

  private cancelAim(): void {
    this.aiming = null
    this.aimView.hide()
    this.leaveAimCamera()
  }

  /** Recomputes and redraws the whole gesture from one pointer position. Everything on screen is
   * derived, so there is no aim state to keep in step — the only thing remembered between calls is
   * which disc is held. */
  private paintAim(pointerX: number, pointerY: number): void {
    const shooter = this.aiming
    if (!shooter) return

    const aim: Aim = computeAim(shooter, pointerX, pointerY)
    const contact = firstContact(this.sim, shooter, aim.angle, this.simConfig)
    const reach = reachOf(aim.power, this.simConfig, shooter)

    // The line ends at whichever comes first: the thing the shot would hit, or the point the shot
    // runs out of energy. A pull too weak to reach its target therefore draws a line that visibly
    // stops short, instead of a confident one to something it cannot get to.
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
    this.tickSlowMotion(delta)

    // The turn light follows the SOLVER, so it has to be re-evaluated as the solver runs — not only
    // when the turn changes, which is what `refreshStatus` does. Guarded on the transition rather
    // than redrawn every frame: it is a Graphics, and nothing about it changes between two frames
    // of the same state.
    const moving = isMoving(this.sim)
    if (moving !== this.wasMoving) {
      this.wasMoving = moving
      this.refreshBoardState()
    }

    if (moving) {
      advance(this.stepper, this.sim, this.simConfig, (delta / 1000) * this.simTimeScale, this.shotOutcome ?? undefined)
      this.discView.draw(this.sim, this.stepper.alpha)
      this.layTrail(delta)

      // A shot that will not settle is always a solver bug, never gameplay. The same ceiling
      // `runToRest` applies, applied to the live path through the same function — and reported,
      // because a timeout that reaches only a console nobody is reading is not loud at all.
      if (this.shotOutcome) {
        this.soundImpacts(this.shotOutcome)
        this.burstKnockouts(this.shotOutcome)
        this.maybeSlowMotion(this.shotOutcome)

        if (freezeIfStalled(this.sim, this.simConfig, this.shotOutcome)) {
          console.error('[sim] a shot ran past the time ceiling and was frozen', this.shotOutcome)
          logError()
        }
      }
    } else {
      // At rest, draw at alpha 1 — the last step left `prevX` a step behind `x`, and interpolating
      // toward a frozen position would park every disc a fraction short of where the solver (and
      // therefore aiming, the bot, and the save) says it is.
      resetStepper(this.stepper)
      this.discView.draw(this.sim, 1)
      if (this.shotOutcome) this.settleShot(this.shotOutcome)
      // In two-player mode the opponent's turn belongs to a person, so nothing thinks for them.
      else if (this.isSolo() && !this.round.winner && this.round.turn === BOT_SIDE) this.think(delta)
      else this.tickShotClock(delta)
    }

    if (import.meta.env.DEV) this.updateDebugText()
  }

  /**
   * §5's slow-motion finish: the shot that empties the opponent's side plays out at 40% speed.
   *
   * Armed the moment the last enemy disc leaves, not when the board settles — the point is to watch
   * it go over the edge, and by the time everything has stopped there is nothing left to slow down.
   * Fires at most once per shot, and only on the shot that ends a round, so it stays an event rather
   * than a mannerism.
   */
  private maybeSlowMotion(outcome: SimOutcome): void {
    if (this.slowMotionUntil > 0) return
    if (outcome.knockedOff.length === 0) return
    if (liveDiscs(this.sim, BOT_SIDE).length > 0) return

    this.slowMotionUntil = SLOWMO_MS
    this.time.timeScale = SLOWMO_SCALE
    this.tweens.timeScale = SLOWMO_SCALE
    this.simTimeScale = SLOWMO_SCALE
  }

  /** Winds the slow motion back out. Driven off real elapsed time so the effect lasts the same
   * fraction of a second however slow the world currently is. */
  private tickSlowMotion(delta: number): void {
    if (this.slowMotionUntil <= 0) return

    this.slowMotionUntil -= delta
    if (this.slowMotionUntil > 0) return

    this.slowMotionUntil = 0
    this.time.timeScale = 1
    this.tweens.timeScale = 1
    this.simTimeScale = 1
  }

  /**
   * §5's blitz timer, counted down only while it is somebody's turn to shoot.
   *
   * Not while the board is settling and not while the round is over: a clock that runs during a shot
   * is timing the physics rather than the decision, which is the opposite of what the mode is for.
   */
  private tickShotClock(delta: number): void {
    // Never against the bot: the clock exists to hurry a human's decision, and the bot's is already
    // bounded by its own frame budget.
    // `humanSide()` rather than the player's: a `blitz` match between two friends has to hurry
    // both of them, and a clock that only runs on one side is a rule that applies to one player.
    if (this.rules.shotClockMs <= 0 || this.round.winner || this.round.turn !== this.humanSide()) return

    this.shotClockLeft -= delta
    if (this.shotClockLeft > 0) {
      this.refreshStatus()
      return
    }

    this.cancelAim()
    this.lastResolution = forfeitShot(this.round)
    this.shotClockLeft = this.rules.shotClockMs
    this.refreshStatus()
  }

  /**
   * The shot has come to rest — hand it to the round.
   *
   * Everything §3 needs to decide the turn is already in the outcome, collected as the shot played
   * out: who went off and whose they were, and whether an enemy was touched at all. `game/round.ts`
   * turns that into whose move it is, and this puts the answer on screen.
   */
  private settleShot(outcome: SimOutcome): void {
    const before = this.boardBeforeShot
    this.shotOutcome = null
    this.boardBeforeShot = null

    // Any contact still unheard — a last quiet tap as everything came to rest — and any disc that
    // left on the very last step, which would otherwise never get its burst.
    this.soundImpacts(outcome)
    this.burstKnockouts(outcome)

    const resolution = resolveShot(this.round, this.rules, this.sim, this.board.metrics, outcome)
    this.lastResolution = resolution
    // A fresh clock for whoever is to move now, whether the turn passed or was kept.
    this.shotClockLeft = this.rules.shotClockMs

    this.reactTo(outcome, resolution.winner)

    // §5's score and its cues. Only the player's shots score: the bot's successes are the reason to
    // beat it, not a contribution to the run.
    let score: ShotScore | null = null
    if (before && outcome.shooterSide === PLAYER_SIDE) {
      score = scoreShot(outcome, before, this.sim)
      this.match.score += score.points
      if (score.knockouts > 0) this.celebrate(score)
    }

    if (resolution.winner) this.finishRound(resolution.winner)
    else this.persist()

    this.refreshStatus()

    if (import.meta.env.DEV) {
      const peak = peakImpact(outcome)
      console.debug(
        `[round] ${outcome.shooterSide} shot: ${enemyKnockouts(outcome)} enemy off, ${ownKnockouts(outcome)} own off, ` +
          `touchedEnemy=${outcome.touchedEnemy} -> ${resolution.reason}, ${resolution.turn} to move with ${resolution.shotsLeft}` +
          (score ? `, +${score.points}${score.tricks.length ? ` [${score.tricks.join(',')}]` : ''}` : '') +
          (resolution.winner ? `, WINNER ${resolution.winner}` : '') +
          (peak ? `, hardest ${(peak.speed / CELL).toFixed(1)} cells/s` : ''),
      )
    }
  }

  /**
   * **What the opponent has to say about the shot that just landed.**
   *
   * One place, reading the outcome that already exists rather than being called from the six places
   * that could each notice a thing worth commenting on — a character that speaks from six call sites
   * is a character whose rate limit has six ways to be bypassed.
   *
   * The order of the tests IS a priority: a shot can be several of these at once (it took two of
   * yours AND shoved one of its own off), and the most dramatic thing that happened should be the
   * thing it reacts to. Its own blunder outranks its own combo, because a character that crows about
   * a double while its own disc is still falling reads as not having noticed.
   */
  private reactTo(outcome: SimOutcome, winner: Side | null): void {
    this.speech.noteShot()

    if (winner) {
      // The round is over: `finishRound` raises the result panel a beat later, and the last thing
      // the loser says belongs before it rather than under it.
      this.say(winner === PLAYER_SIDE ? 'onLose' : 'onWin', winner === PLAYER_SIDE ? 'alarm' : 'triumph')
      return
    }

    const theirs = outcome.shooterSide !== PLAYER_SIDE
    const enemyOff = enemyKnockouts(outcome)
    const ownOff = ownKnockouts(outcome)

    if (theirs) {
      if (ownOff > 0) this.say('onOwnBlunder', 'alarm')
      else if (enemyOff > 1) this.say('onOwnCombo', 'triumph')
      else if (enemyOff === 1) this.say('onOwnKnockout', 'triumph')
      else if (outcome.touchedEnemy) this.say('onOwnHit', 'calm')
      else this.say('onOwnMiss', 'calm')
    } else if (enemyOff > 0) {
      // From the PLAYER's shot, `enemyKnockouts` counts the opponent's own discs — so this is the
      // character watching one of its discs leave, which is the one thing on its list that is about
      // something you did.
      this.say('onPlayerKnockout', 'alarm')
    } else if (ownOff > 0) {
      // And this is you posting one of your OWN off, which is the funniest thing that happens in
      // this game and which the character used to watch in total silence. Tested after
      // `onPlayerKnockout` for the same priority reason the branch above is ordered as it is: a shot
      // that took one of its discs AND cost you one of yours is, from where it is standing, first of
      // all a loss.
      this.say('onPlayerBlunder', 'triumph')
    }

    if (liveDiscs(this.sim, 'opponent').length <= LOW_DISCS) this.say('onLowDiscs', 'alarm')
  }

  /**
   * Where the opponent's line sits: directly under the status plate, in the same HUD band.
   *
   * **Wrapped to the plate's own width and never wider**, so a long quip grows DOWNWARD into the
   * band's slack instead of sideways into the board. The band is what `computeHudBands()` reserves
   * and the board's square is what it reserves it against — a line that spilled past it would be
   * text a player has to aim through.
   */
  /**
   * Where the status capsule's CENTRE goes once the portrait has taken its column.
   *
   * The face and the capsule are one block centred on the band, so the capsule shifts right by half
   * the portrait's footprint rather than staying on the band's centre with a face hanging off its
   * left edge. Kept as arithmetic in one place because both orientations need the identical sum and
   * two copies of it would drift.
   */
  private speakerColumnX(band: Rect, statusWidth: number, scale: number): number {
    const column = portraitWidthFor(HUD_PORTRAIT_HEIGHT * scale) + PORTRAIT_GAP * scale
    const block = column + statusWidth
    const margin = 6 * scale
    const centre = band.x + band.width / 2
    // Centred in the band, then pushed back inside it if it does not fit. Clamped from the LEFT
    // last, so when the block is genuinely wider than the band the face stays whole and the capsule
    // is what overhangs — a portrait cut in half by the screen edge is the worse of the two.
    let left = Math.min(centre - block / 2, band.x + band.width - margin - block)
    left = Math.max(left, band.x + margin)
    return left + column + statusWidth / 2
  }

  /** `rightEdge` is where the portrait's column ENDS — its right side touches the capsule's left. */
  private layoutPortrait(rightEdge: number, bottomY: number, scale: number): void {
    const height = HUD_PORTRAIT_HEIGHT * scale
    const width = portraitWidthFor(height)
    // Positioned through `placePortrait` and never by hand: it is the one place the uniform-scale
    // rule lives, and a portrait sized on two axes separately re-stretches an aspect ratio that is
    // already correct.
    placePortrait(this.portrait, rightEdge - PORTRAIT_GAP * scale - width / 2, bottomY, height)
  }

  /** `y` is the TOP of the reserved speech row — see the origin the text is created with. Passing
   * the row's top and letting the object grow downward is what keeps a line that is still typing
   * from reaching back up into the status capsule. */
  private layoutSpeech(x: number, y: number, width: number, scale: number): void {
    this.speechText.setFontSize(SPEECH_FONT_SIZE * scale)
    this.speechText.setWordWrapWidth(width)
    this.speechText.setPosition(x, y)
  }

  /**
   * The character's reaction: **the face always, the words only if the rate limit allows them.**
   *
   * The split is the point. `game/speech.ts` limits the WORDS hard, because a character that
   * remarks on every knockout is a stream of text over the board — but the player still has to see
   * that its disc going over the edge landed, every single time, or the character reads as not
   * having noticed. So the portrait reacts first and unconditionally, and the line is whatever the
   * director is willing to give on top of that.
   */
  private say(trigger: SpeechTrigger, mood: VoiceMood): void {
    // Nobody is sitting across the board except the other player. One gate here rather than at each
    // of `reactTo`'s eleven triggers.
    if (this.twoPlayer) return
    reactPortrait(this, this.portrait, mood)

    const line = this.speech.next(trigger)
    if (!line) return

    this.opponentVoice?.stop()
    // A manager per line rather than one per scene: it carries the line's own contour — where the
    // end is and what punctuation it carries — and a shared one would have to be told to forget.
    const voice = createDialogueVoice(this.opponent.voice, this.opponent.cadence, SPEECH_TYPE_MS)
    voice.begin(line, mood)
    this.opponentVoice = voice
    this.speechLine.onGlyph = (_revealed, _total, char, end) => voice.playLetterSound(char, end)
    this.speechLine.say(line)
  }

  /**
   * What the board itself says: how many discs each side has left.
   *
   * It used to also light a band on the active side's edge (see `board/boardView.ts`'s note on why
   * that band is gone). Whose go it is now lives entirely in `refreshStatus()`'s words, and the input
   * gate never depended on the light being drawn — `beginAim` refuses on `isMoving` either way.
   */
  private refreshBoardState(): void {
    this.discCounter.setCounts(liveDiscs(this.sim, 'player').length, liveDiscs(this.sim, 'opponent').length)
  }

  /**
   * §5's response to a scoring shot: a rising pitch for a combo, and coins for the extra discs.
   *
   * The pitch step per extra disc is the plan's own suggestion, and it is the whole cue — a combo is
   * heard before it is read, which is what makes a double feel different from two singles rather than
   * merely score differently.
   */
  private celebrate(score: ShotScore): void {
    playSfx(SFX.promote, { rate: 1 + (score.knockouts - 1) * COMBO_RATE_STEP })
    const coins = awardComboCoins(score.knockouts)
    if (coins > 0) this.topBar.setCoins(coinBalance())
    if (score.knockouts >= 2) this.popCombo(score.knockouts)
  }

  /**
   * The combo, as a number that rises off the board where it was earned.
   *
   * **On the board, in world space — not in the HUD.** §5's multiplier is the loudest thing the
   * scoring system does (two discs score 400, not 200), and it happens at a place: the shot that
   * did it. A counter in the corner makes the player look away from the exact moment they wanted
   * to watch, and then occupies that corner permanently for something that is true for a second and
   * a half. This lives where it happened and then stops existing.
   */
  private popCombo(knockouts: number): void {
    // The LAST contact of the shot, because that is where the combo finished — and `a`/`b` are the
    // solver's traversal order, not shooter and target (`sim/outcome.ts`'s documented footgun), so
    // either may be the one still on the board.
    const at = this.shotOutcome?.impacts.at(-1)
    const disc = at ? (findDisc(this.sim, at.a) ?? (at.b === null ? undefined : findDisc(this.sim, at.b))) : null
    const x = disc?.x ?? this.board.metrics.boardW / 2
    const y = disc?.y ?? this.board.metrics.boardH / 2

    const label = this.add
      .text(x, y, `x${knockouts}`, { fontFamily: getDisplayFontStack(), fontSize: 34, color: '#ffcf3f' })
      .setOrigin(0.5)
      .setStroke('#241033', 6)
      .setDepth(COMBO_DEPTH)
    // A world object: it has to travel with the board's zoom and pan, because it is a thing that
    // happened at a place on the board rather than a message about the game.
    this.uiCamera.ignore(label)

    this.tweens.add({
      targets: label,
      y: y - this.board.metrics.tile * 1.2,
      alpha: 0,
      scale: 1.25,
      duration: COMBO_LIFE_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    })
  }

  /**
   * The round is over: pay it out, fold it into the match, and show the result.
   *
   * The order matters. The round's own payout and stats are settled first, then the match decides
   * whether it is over too, and only then does the overlay go up — so whatever the player sees is
   * already true of the save behind it.
   */
  private finishRound(winner: Side): void {
    playSfx(winner === PLAYER_SIDE ? SFX.win : SFX.lose)

    const summary = summarise(this.round, this.rules)
    if (!summary) return

    // Captured BEFORE `recordRound`, which advances the round index: the panel names the branch this
    // round was fought with, not the one the next round will use.
    const formation = currentFormation(this.match)
    // **Nothing is awarded in two-player mode, and that is the rule the mode is built around.**
    // Every one of these — coins, the run record, the ladder unlock, the leaderboard — is a
    // statement about THE player, and a hot-seat match has two of them sharing one save. Paying
    // out would also make the whole economy farmable by beating yourself, which is the sort of
    // thing a person finds in ten minutes.
    let coins = this.isSolo() && winner === PLAYER_SIDE ? awardRoundCoins() : 0

    recordRound(this.match, summary, this.rules.advanceOnCleanWin)

    if (this.match.winner) {
      const won = this.match.winner === PLAYER_SIDE
      if (this.isSolo()) {
      coins += awardMatchCoins(won ? 'won' : 'lost')
      recordResult(this.rules.id, won ? 'won' : 'lost')
      // **The unlock, and it is filed on a MATCH win rather than a round win.** A round is one of
      // five and losing three of them still loses the match; unlocking the next rung for taking a
      // single round off a character would let a player walk the whole ladder without beating
      // anybody. Only here, and only on `won` — see `rememberDefeated`.
      if (won) rememberDefeated(this.opponent.id)
      // The platform's leaderboard takes the match total, once, at the end — `sendScore` rounds for
      // us and never rejects, so this is fire-and-forget by design (see `platform/yt.ts`).
      void sendScore(this.match.score)
      }
      // Outside the guard: the record has to go whichever kind of match just ended, or `Continue`
      // would offer a match that is already over.
      clearMatch()
    } else {
      this.persist()
    }

    this.topBar.setCoins(coinBalance())
    // Both are read-and-raise in one call, so the panel can award a badge without reading the old
    // value first and racing the store's own debounce.
    // Ternaries rather than `&&`: both of these RECORD as well as report, so short-circuiting is
    // the point — a hot-seat score must not enter the single-player best.
    const isBest = this.isSolo() ? recordScore(this.match.score) : false
    const isComboBest = this.isSolo() ? recordCombo(summary.bestCombo[PLAYER_SIDE]) : false

    const data: MatchResultData = {
      opener: 'Game',
      scope: this.match.winner ? 'match' : 'round',
      winner,
      formation,
      // Counted from the board rather than from a tally: it is the round's actual outcome, and the
      // board is the thing that decided it.
      discsLeft: liveDiscs(this.sim, PLAYER_SIDE).length,
      wins: { ...this.match.wins },
      results: [...this.match.results],
      knockedOut: summary.knockedOut[PLAYER_SIDE],
      bestCombo: summary.bestCombo[PLAYER_SIDE],
      shots: summary.shots,
      coins,
      totalScore: this.match.score,
      cleanWin: summary.cleanWin,
      isBest,
      isComboBest,
      onContinue: () => this.continueAfterResult(summary.firstNextRound),
      // Only on a match the PLAYER won. A match lost leaves the ladder where it was, so there is no
      // next character to go to and the primary button stays the rematch — which is what somebody
      // who just lost wants anyway.
      twoPlayer: this.twoPlayer,
      // No ladder in a hot-seat match, so no next character to point at either.
      onNext: this.isSolo() && this.match.winner === PLAYER_SIDE ? () => this.chooseNextOpponent() : undefined,
      onQuit: () => this.scene.start('MainMenu'),
    }
    this.scene.pause()
    this.scene.launch('MatchResult', data)
  }

  /**
   * Opens the gallery so the player can pick who is next, after winning a match.
   *
   * The same launch `Modes` makes, from here instead — `rememberDefeated` has already run by the
   * time the panel appears, so the character this win unlocked is shown unlocked rather than
   * arriving one match late. `opener: 'Game'` and a pause, so backing out of the gallery returns to
   * the board that is still standing behind it rather than dumping the player on the menu.
   */
  private chooseNextOpponent(): void {
    this.scene.pause()
    this.scene.launch('Opponents', {
      opener: 'Game',
      rules: this.rules.id,
      // A whole new match against whoever was picked — including, deliberately, the same character
      // again, which is what the rematch this button replaced used to do.
      onStart: () => this.scene.start('Game', { resume: false }),
      // Backing out has to LEAVE, not resume: the board behind this panel belongs to a match that is
      // already over, so resuming it strands the player on a screen that accepts no shot and has no
      // result panel left to offer an exit.
      onCancel: () => this.scene.start('MainMenu'),
    })
  }

  /** Carries on from the result overlay: the next round of this match, or a whole new match if the
   * last one finished. */
  private continueAfterResult(first: Side): void {
    if (this.match.winner) {
      this.match = createMatch(this.rules.id)
      this.startRound(this.match.first)
      return
    }
    this.startRound(first)
  }

  /**
   * The two blocks, as state.
   *
   * **Whose turn it is is the LIT BLOCK**, not a line of text somewhere else — see
   * `ui/playerBlock.ts` for why, and note that this is the second time a turn signal has moved in
   * this game for the same reason. The sub-line carries the standing fact and is borrowed by the
   * state, so there is no row sitting empty for most of a match.
   *
   * A no-op outside panel mode: the strips say all of this themselves, and paying to update two
   * hidden components on every status change would be a cost with nothing on the other side.
   */
  private updateBlocks(): void {
    if (this.panelFit?.mode !== 'panel') return

    const mine = liveDiscs(this.sim, PLAYER_SIDE).length
    const theirs = liveDiscs(this.sim, BOT_SIDE).length
    const over = Boolean(this.round.winner)

    this.opponentBlock.setName(this.twoPlayer ? t('p2Name') : t(this.opponent.nameKey))
    this.opponentBlock.setDiscs(theirs)
    this.opponentBlock.setActive(!over && this.round.turn === BOT_SIDE)

    this.playerBlock.setName(this.twoPlayer ? t('p1Name') : t('youName'))
    this.playerBlock.setDiscs(mine)
    this.playerBlock.setActive(!over && this.round.turn === PLAYER_SIDE)
    // The balance lives here in panel mode rather than in the top bar, or the same number is on
    // screen twice in one frame.
    this.playerBlock.setSubline(`🪙 ${coinBalance()}`)
    this.opponentBlock.setSubline(this.twoPlayer ? '' : `${t('roundOf', { n: roundNumber(this.match), total: MATCH_ROUNDS })}`)

    if (over) {
      const won = this.round.winner === PLAYER_SIDE
      this.playerBlock.setStatus(won ? t('resultWin') : null, 'alert')
      this.opponentBlock.setStatus(won ? null : t('resultWin'), 'alert')
      return
    }

    // The bot's own ellipsis stays on the bot's block. `refreshStatus` is what animates it, so this
    // is re-entered every frame while a search runs and the dots advance in place.
    if (this.botSearch) {
      const dots = 1 + (Math.floor(this.thinkingElapsed / THINKING_DOT_MS) % 3)
      this.opponentBlock.setStatus(`${t('botThinking')}${'.'.repeat(dots)}`)
      this.playerBlock.setStatus(null)
      return
    }

    const mineTurn = this.round.turn === PLAYER_SIDE
    // Only ONE of them ever shows a status: two blocks both claiming to be doing something is the
    // ambiguity the lit edge exists to remove.
    this.playerBlock.setStatus(mineTurn ? this.turnLine(PLAYER_SIDE) : null)
    this.opponentBlock.setStatus(mineTurn ? null : this.turnLine(BOT_SIDE))
  }

  /** What the active side's block says under its name. The penalty and the shot count are the same
   * facts the capsule carries in the strip layout — they belong to the side that owes the shots. */
  private turnLine(side: Side): string {
    if (this.twoPlayer) return t(side === PLAYER_SIDE ? 'p1Turn' : 'p2Turn')
    if (this.lastResolution?.reason === 'penalty') return t('penaltyShots')
    if (this.round.shotsLeft > 1) return t('shotsLeft', { n: this.round.shotsLeft })
    return t(side === PLAYER_SIDE ? 'yourShot' : 'opponentShot')
  }

  /**
   * The one line of HUD that says what is going on.
   *
   * Rebuilt from the round rather than accumulated, so it cannot drift out of step with the state it
   * describes — the same reason the aim overlay is fully derived from the pointer.
   */
  private refreshStatus(): void {
    this.refreshActions()
    this.refreshBoardState()
    this.updateBlocks()
    this.topBar.setRound(roundNumber(this.match), MATCH_ROUNDS)
    this.topBar.setCoins(coinBalance())

    if (this.round.winner) {
      // The result overlay says the rest; this only has to stop claiming it is somebody's turn.
      this.statusText.setText(
        this.twoPlayer
          ? t(this.round.winner === PLAYER_SIDE ? 'p1Wins' : 'p2Wins')
          : t(this.round.winner === PLAYER_SIDE ? 'resultWin' : 'resultLoss'),
      )
      this.layoutHud()
      return
    }

    if (this.botSearch) {
      // The bot is mid-search. An animated ellipsis, because a static label during a fifth of a
      // second of work reads as the game having hung.
      const dots = 1 + (Math.floor(this.thinkingElapsed / THINKING_DOT_MS) % 3)
      this.statusText.setText(`${t('botThinking')}${'.'.repeat(dots)}`)
      this.layoutHud()
      return
    }

    // "Your shot" is a lie when there are two people holding the device, and knowing whose go it is
    // is the ONE thing a hot-seat game has to say out loud — there is no other cue, both sides sit at
    // one board and the discs do not change colour when the device changes hands.
    const lines = [
      this.twoPlayer
        ? t(this.round.turn === PLAYER_SIDE ? 'p1Turn' : 'p2Turn')
        : t(this.round.turn === PLAYER_SIDE ? 'yourShot' : 'opponentShot'),
    ]

    // Which round of the match this is, and which branch it is fought with — only until the first
    // shot, after which the board says both far better than a caption can and the line is needed
    // for the turn.
    if (this.round.shots === 0) {
      lines.push(`${t('roundOf', { n: roundNumber(this.match), total: MATCH_ROUNDS })} · ${t(formationKey(this.formation))}`)
    }

    // Why the turn is where it is, but only while it is still news — a "penalty" label that outlives
    // the shot that caused it stops meaning anything.
    if (this.lastResolution?.reason === 'penalty') lines.push(t('penaltyShots'))
    else if (this.lastResolution?.reason === 'extraShot') lines.push(t('extraShot'))
    else if (this.round.shotsLeft > 1) lines.push(t('shotsLeft', { n: this.round.shotsLeft }))

    if (this.rules.shotClockMs > 0) lines.push(`${Math.max(0, Math.ceil(this.shotClockLeft / 1000))}`)

    this.statusText.setText(lines.join('\n'))
    // **And re-laid out, like the two branches above already do.** The plate is drawn around the
    // text as it is at the moment `layoutHud` runs, and this line grows from one row to three as a
    // round announces itself — so setting it without re-laying it out left a capsule sized for the
    // PREVIOUS status with the new one hanging out of both ends of it. Invisible while the block
    // was centred on the band and symmetric about it; obvious the moment the portrait took the
    // column to its left and the overflow started running across a face.
    this.layoutHud()
  }

  /**
   * Points the world camera at the whole board, centred in the viewport.
   *
   * There is nothing to remember between calls: the board is authored once in board space and
   * always shown whole, so a resize is one zoom assignment plus one `centerOn`. Nothing is re-baked
   * and no disc is repositioned — which is also what keeps a resize mid-shot from perturbing a
   * simulation that must stay deterministic.
   */
  private applyCamera(): void {
    const { boardW, boardH } = this.board.metrics
    // A resize DURING an aim re-enters here. Snapping to the resting fit would yank the apron out
    // from under a drag that is still being made, so the aim's own zoom is re-applied instead — and
    // instantly, because a resize is not an animation.
    const zoom = this.aiming ? computeAimZoom(this.board.metrics, this.viewportW, this.viewportH) : this.fit.zoom
    this.cameraTween?.stop()
    /**
     * The side panel moves the BOARD, and it does it through what the camera centres on.
     *
     * The alternative — giving the world camera a viewport the size of the board — clips the
     * full-bleed background to the board's rectangle and leaves the rest of the screen showing the
     * canvas clear colour. So the camera stays full-viewport and the shift is applied in world
     * units: to move the board LEFT by `d` screen px, centre on a point `d / zoom` to the RIGHT.
     */
    this.setCamera(zoom, this.focusFor(zoom), boardH / 2)

    // Computed here rather than read from `cameras.main.worldView`, which Phaser only refreshes
    // during preRender — it would still hold the PREVIOUS frame's rectangle at this point. Sized on
    // the resting fit: the press that starts a gesture always happens at that zoom, and once
    // `bindDrag` owns the pointer its moves come from the scene rather than from this zone.
    const visibleW = this.viewportW / this.fit.zoom
    const visibleH = this.viewportH / this.fit.zoom
    const centreX = boardW / 2 - this.centreShift() / this.fit.zoom
    this.board.coverWorldView(new Phaser.Geom.Rectangle(centreX - visibleW / 2, boardH / 2 - visibleH / 2, visibleW, visibleH))

    // Cover-fit the background, with a little overscan so a sub-pixel rounding gap never shows a
    // bar of empty canvas at the edge.
    //
    // **Sized on the AIM zoom, not the resting fit.** The plate is a world-space object, so the
    // camera scales it too — and `enterAimCamera` zooms OUT, which means the world rectangle on
    // screen is at its LARGEST exactly while a gesture is being made. Sized on the resting fit the
    // plate covered the viewport at rest and then came up short the moment a disc was pressed: its
    // own edges appeared as a rectangle a little bigger than the board with the flat canvas clear
    // colour around it, so starting to aim made the background visibly end. Cover-fit is centred on
    // the board either way, so covering the largest case over-covers the smallest for free.
    /**
     * Covering the widest zoom is not enough on its own, because the camera does not merely GROW
     * when it pulls back — with a side panel it also MOVES, by `centreShift / zoom`, which is a
     * different distance at each zoom. Sizing for the wider view and placing at the resting centre
     * left the plate 120 world units short on one side, which is how this shipped.
     *
     * So the plate covers the UNION of the two views. That is exact rather than generous: every
     * zoom the tween passes through lies between the endpoints, and both the left and the right
     * edge of the visible rectangle are monotonic in `1 / zoom` — so the extreme of each is at one
     * end or the other, never in the middle.
     */
    const viewAt = (at: number): Phaser.Geom.Rectangle => {
      const w = this.viewportW / at
      const h = this.viewportH / at
      return new Phaser.Geom.Rectangle(this.focusFor(at) - w / 2, boardH / 2 - h / 2, w, h)
    }
    const covered = Phaser.Geom.Rectangle.Union(
      viewAt(this.fit.zoom),
      viewAt(computeAimZoom(this.board.metrics, this.viewportW, this.viewportH)),
    )
    const cover = Math.max(covered.width / this.background.width, covered.height / this.background.height) * BACKGROUND_OVERSCAN
    this.background.setPosition(covered.centerX, covered.centerY).setScale(cover)
  }

  /** How far the board's centre sits from the viewport's, in screen px. Zero without a panel. */
  private centreShift(): number {
    return this.panelFit?.boardOffsetX ?? 0
  }

  layout(width: number, height: number): void {
    this.viewportW = width
    this.viewportH = height

    this.fit = computeBoardFit(this.board.metrics, width, height)
    this.bands = computeHudBands(width, height, this.fit.boardPx)
    // Before `applyCamera`: the board's screen position depends on whether a panel is taking
    // space beside it, and the camera is what puts it there.
    this.panelFit = computeSidePanel(width, height, this.fit.boardPx)
    this.applyCamera()

    this.uiCamera.setViewport(0, 0, width, height)

    const scale = uiScale(width)

    // Positioning only. The round indicator and the balance are STATE, and `bindLayout` runs
    // `layout()` once immediately from `create()` — before the match is assigned, which is exactly
    // where reading `this.match` here threw. They are set from `refreshStatus()` instead, which
    // only ever runs once there is a round to describe.
    this.topBar.layout(width, height)
    this.layoutHud()

    if (import.meta.env.DEV && this.debugText) {
      this.debugText.setFontSize(DEBUG_FONT_SIZE * scale)
      // Under the BOARD rather than under the top bar: the disc counter lives in the leading
      // band now, and a DEV readout across it hides the one thing the HUD is for.
      // Bottom-left corner: the leading band is the disc counter's and the trailing band is the
      // status and the consumables', so the only place a DEV readout covers nothing is under both.
      anchorTopLeft(this.debugText, 8, height - this.debugText.height - 6)
    }
  }

  /**
   * Swaps the HUD between its two shapes.
   *
   * Everything is built in `create()` and hidden here rather than created on demand: the orientation
   * can change at any moment (`bindLayout` re-runs on every resize), and a `create()` that branched
   * on it would leave the other shape unbuildable without a scene restart.
   *
   * The PORTRAIT survives both shapes — it is the opponent's face either way, and only where it
   * stands changes.
   */
  private showPanel(panelled: boolean): void {
    // The balance and the round pill move INTO the panel, so the bar stops drawing them — otherwise
    // each is on screen twice in one frame. Back and the gear stay: they are the way off the screen.
    this.topBar.setBadgesVisible(!panelled)
    this.sidePanel.setVisible(panelled)
    this.opponentBlock.setVisible(panelled)
    this.playerBlock.setVisible(panelled)
    this.playerAvatar.setVisible(panelled && this.playerAvatar.texture.key !== '__DEFAULT')
    // Panel-only. In the strip layout the top bar's back button is the way out and the shop is a nav
    // tab away; there is no room for a second pair of buttons and no argument for one.
    this.shopButton.container.setVisible(panelled)
    this.shopButton.hitArea.input!.enabled = panelled
    this.leaveButton.container.setVisible(panelled)
    this.leaveButton.hitArea.input!.enabled = panelled

    // The capsule and the pip counter are what the panel REPLACES: whose turn it is becomes the lit
    // block, and the disc counts become the two numbers in it. Leaving either up would say the same
    // thing twice in one frame — the defect this game already fixed once when a turn light on the
    // board's rim was reported as scenery.
    this.statusPlate.setVisible(!panelled)
    this.statusText.setVisible(!panelled)
    for (const object of this.discCounter.objects) (object as Phaser.GameObjects.Image).setVisible(!panelled)
    this.portrait.setVisible(this.isSolo())
  }

  /**
   * The side panel: opponent block, what it is saying, the consumables, the player block.
   *
   * Four zones where the reference has five — its move list is gone, because a round here is a
   * sequence of flicks rather than of notated moves and a column of "player 1 flicked" would be the
   * tallest thing on the screen and the least read. What takes the middle instead is the OPPONENT'S
   * LINE, which in the band layout has a row of its own under the status: a character that talks
   * wants somewhere to talk, and a slot under its own face is where a reader looks for it.
   */
  private layoutPanel(): void {
    const panel = this.panelFit.panel
    if (!panel) return
    const scale = uiScale(this.viewportW)
    const pad = 12 * scale
    const gap = 10 * scale

    /**
     * Four buttons in two pairs — the consumables, then the shop and the way out.
     *
     * **TWO ROWS IS THE PANEL'S BUDGET, and letting a pair split into two more was a shipped bug.**
     * At 844x390 the panel sits at its 280-unit minimum, where a pair of `compact` buttons comes to
     * 344 against 261 of room, so BOTH pairs split and the actions became four rows: 291px of a
     * 374px panel, against two 56px blocks and a line of speech that also have to live there. The
     * block heights give way first and they have a floor, so what gave next was the top of the
     * panel — the retake button was drawn over the opponent's own name at 844x390 and at **y = -6**,
     * off the top of the screen, at 740x360.
     *
     * So a pair that does not fit is SHRUNK until it does. The note that used to be here said
     * shrinking was not available because every button in a group is one size — true of the size
     * TOKEN, which is why they are still all one token, and not true of `layout`'s scale, which is
     * the same lever `MainMenu` uses to fit its own column on a short screen. Tap targets do not
     * shrink with it (`gameButton` floors every hit area at `MIN_TOUCH_TARGET`), so the cost is
     * legibility, and only on the shapes that were previously broken.
     */
    const actions = [this.retakeButton, this.powerButton, this.shopButton, this.leaveButton]
    const room = panel.width - pad * 2
    let actionScale = scale
    const widestPair = (): number => {
      for (const button of actions) button.layout(0, 0, actionScale)
      return Math.max(
        this.retakeButton.width + gap + this.powerButton.width,
        this.shopButton.width + gap + this.leaveButton.width,
      )
    }
    /**
     * Solved by ITERATION, not by one division, and the first attempt at this shipped the same four
     * rows it was written to prevent: a button's width is its label's text metrics plus padding, so
     * it does not scale strictly proportionally, and the single-shot factor landed the pair at
     * 262 against 261 of room — over by one pixel, split again, four rows again. Three passes is
     * comfortably enough for a fixed point; the floor ends it either way.
     */
    for (let pass = 0; pass < 3 && widestPair() > room && actionScale > PANEL_MIN_ACTION_SCALE * scale; pass++) {
      actionScale = Math.max(PANEL_MIN_ACTION_SCALE * scale, actionScale * (room / widestPair()) * 0.98)
    }
    for (const button of actions) button.layout(0, 0, actionScale)
    const rows: GameButton[][] = [
      [this.retakeButton, this.powerButton],
      [this.shopButton, this.leaveButton],
    ].flatMap((pair) => (pair[0].width + gap + pair[1].width <= room ? [pair] : [[pair[0]], [pair[1]]]))
    const buttonH = this.retakeButton.height
    const actionsH = rows.length * buttonH + (rows.length - 1) * gap + pad * 2

    /**
     * **The blocks give way to the buttons, not the other way round.**
     *
     * Four buttons on a narrow panel can want four rows, and 96-unit blocks top and bottom then add
     * up to more than the panel is tall — the panel is exactly as tall as the board, so there is no
     * more to have. A block can lose height and still be a face with a name beside it; a button that
     * has been pushed off the slab is gone. The floor is what still fits a legible face.
     */
    const blockH = Math.max(
      PANEL_BLOCK_MIN_HEIGHT * scale,
      Math.min(PANEL_BLOCK_HEIGHT * scale, (panel.height - actionsH - PANEL_SPEECH_MIN_HEIGHT * scale) / 2),
    )

    const oppTop = panel.y
    const playerTop = panel.y + panel.height - blockH
    const actionsTop = playerTop - actionsH

    this.sidePanel.layout(panel.x, panel.y, panel.width, panel.height, scale, [oppTop + blockH, actionsTop, playerTop])
    this.opponentBlock.layout(panel.x, oppTop, panel.width, blockH, scale)
    this.playerBlock.layout(panel.x, playerTop, panel.width, blockH, scale)

    // Both avatars stand on the FLOOR of their own slot: a portrait is positioned by its feet (see
    // `ui/portrait.ts`), and the disc is centred in the same box so the two read as one row.
    const oppSlot = this.opponentBlock.avatarBox
    placePortrait(this.portrait, oppSlot.x, oppSlot.y + oppSlot.size / 2, oppSlot.size)
    const playerSlot = this.playerBlock.avatarBox
    this.playerAvatar.setPosition(playerSlot.x, playerSlot.y).setDisplaySize(playerSlot.size * 0.7, playerSlot.size * 0.7)

    // The line, wrapped to the panel and anchored by its TOP — it types itself in one character at a
    // time and grows downward, which is the whole of a bug this game already paid for once.
    this.speechText.setFontSize(SPEECH_FONT_SIZE * scale)
    this.speechText.setWordWrapWidth(panel.width - pad * 2)
    this.speechText.setPosition(panel.x + panel.width / 2, oppTop + blockH + pad)

    const centre = panel.x + panel.width / 2
    let rowY = actionsTop + pad + buttonH / 2
    for (const row of rows) {
      const width = row.reduce((sum, button) => sum + button.width, 0) + gap * (row.length - 1)
      let x = centre - width / 2
      for (const button of row) {
        button.layout(x + button.width / 2, rowY, actionScale)
        x += button.width + gap
      }
      rowY += buttonH + gap
    }
  }

  /**
   * The HUD, in the two strips the board leaves over.
   *
   * **Which strips those are flips with the orientation, and that is the whole design.** A square
   * board binds on the viewport's shorter side, so in landscape there is no vertical slack at all —
   * a bar above or below would come straight out of the board's edge, i.e. out of every disc's
   * diameter and out of the precision of every aim. In portrait the reverse: 454px of vertical room
   * going spare and none horizontally. `board/layout.ts`'s `computeHudBands` is where that lives;
   * this only fills them.
   *
   * Called from `layout()` AND from every status change, because the status line grows and shrinks —
   * one line for a plain turn, three when it is announcing the round, the branch and a penalty.
   * Positioning the pieces independently is what let them collide the first time.
   */
  private layoutHud(): void {
    if (!this.bands) return

    // The panel is the landscape HUD wherever it fits; the two strips are the fallback, and
    // portrait is always the fallback. `board/layout.ts`'s `computeSidePanel` decides, so the rule
    // is testable in node and this is only the filling.
    const panelled = this.panelFit?.mode === 'panel'
    this.showPanel(panelled)
    if (panelled) {
      this.layoutPanel()
      return
    }

    const scale = uiScale(this.viewportW)
    const portrait = this.bands.orientation === 'portrait'
    const leading = bandCenter(this.bands.leading)
    const trailing = bandCenter(this.bands.trailing)

    // In portrait the leading band also holds the top bar, so the counter sits in what is left
    // below it rather than in the band's own centre.
    const counterY = portrait ? (this.topBar.height(this) + this.bands.leading.height) / 2 : leading.y - 40 * scale
    this.discCounter.layout(leading.x, counterY, scale)

    this.statusText.setFontSize(STATUS_FONT_SIZE * scale)
    this.retakeButton.layout(0, 0, scale)
    this.powerButton.layout(0, 0, scale)

    const gap = 10 * scale

    /**
     * **The status is wrapped to what is left of its band after the portrait's column.**
     *
     * It never was, and on a phone in landscape the band is only ~235px: the capsule grew to fit
     * "Round 1/5 · Infantry" on one line, the block came out wider than the band it sits in, and the
     * face was pushed five pixels off the left edge of the screen. Wrapping is the honest fix —
     * clamping the plate alone would just clip the text it is drawn around.
     */
    const band = portrait ? this.bands.trailing : this.bands.leading
    const column = portraitWidthFor(HUD_PORTRAIT_HEIGHT * scale) + PORTRAIT_GAP * scale
    const statusRoom = Math.max(110 * scale, band.width - column - 16 * scale)
    this.statusText.setWordWrapWidth(statusRoom - 28 * scale)

    // Measured from the text as it is NOW. The status grows from one line to three as the round
    // announces itself, and a plate sized from a remembered height is a plate the second line
    // hangs out of — which is exactly what it did.
    const statusW = Math.min(statusRoom, Math.max(this.statusText.width + 28 * scale, 120 * scale))
    const statusH = this.statusText.height + 16 * scale

    if (portrait) {
      /**
       * Stacked, not side by side, and SHRUNK to the band rather than centred in it.
       *
       * The brief describes one strip with the status at the left and the consumables at the right,
       * and it does not fit: the capsule plus two `compact` buttons is 478 design units against a
       * 390px phone. Side by side either shrinks the buttons below the token — breaking the "all
       * buttons in a group are one size" rule the whole factory exists for — or runs them off the
       * screen, which is what it did.
       *
       * So the strip is two rows, and the block is fitted to the band the same way `Settings` fits
       * its panel to the viewport's HEIGHT: `uiScale` reads the WIDTH, which says nothing about how
       * much vertical room a square board has left over. **A SHORT phone is where that bites** —
       * 375x664 and 360x640 leave the trailing band 152 and 148px against a block that wants ~153,
       * so a block merely CENTRED in the band hung a pixel off the bottom of the screen with the
       * two priced buttons on it, and the guided tour's ring around one of them was cut in half.
       * A tall phone has 37-41px of slack and never showed it.
       *
       * The status is placed first and the buttons measured against the height it has RIGHT NOW: it
       * grows from one line to three as the round announces itself, and whichever of the two was
       * positioned against the other's stale size is the one that ends up underneath it.
       */
      const insetBottom = screenInsets(this).bottom
      const margin = HUD_BAND_MARGIN * scale
      const room = this.bands.trailing.height - insetBottom - margin * 2

      /**
       * Measured per pass, not divided once.
       *
       * A `Text`'s height quantises to whole lines, so the block does not shrink smoothly with the
       * scale — one division lands short or long. Same finding as the side panel's button pairs,
       * which came out a pixel over their own panel when the factor was computed in one shot.
       */
      let hudScale = scale
      let block = this.measureTrailingStack(hudScale)
      for (let pass = 0; pass < 3 && block > room; pass += 1) {
        hudScale = Math.max(scale * MIN_HUD_SHRINK, hudScale * (room / block))
        block = this.measureTrailingStack(hudScale)
      }

      const speechRow = SPEECH_ROW_HEIGHT * hudScale
      const stackStatusH = this.statusText.height + 16 * hudScale
      const stackColumn = portraitWidthFor(HUD_PORTRAIT_HEIGHT * hudScale) + PORTRAIT_GAP * hudScale
      const stackRoom = Math.max(110 * hudScale, this.bands.trailing.width - stackColumn - 16 * hudScale)
      const stackW = Math.min(stackRoom, Math.max(this.statusText.width + 28 * hudScale, 120 * hudScale))

      // Centred in the band where it fits, and pushed off the bottom edge where it does not — the
      // floor below wins over the centring, since what is at the bottom of this block is two
      // buttons and what is at the top of it is empty background.
      const floor = this.viewportH - insetBottom - margin
      const top = Math.max(this.bands.trailing.y + margin, Math.min(trailing.y - block / 2, floor - block))

      // Text first, plate second, around where the text actually ended up.
      const statusX = this.speakerColumnX(this.bands.trailing, stackW, hudScale)
      this.statusText.setPosition(statusX, top + stackStatusH / 2)
      this.drawStatusPlate(this.statusText.x, this.statusText.y, stackW, stackStatusH, hudScale)
      this.layoutSpeech(this.statusText.x, top + stackStatusH + 4 * hudScale, stackW, hudScale)
      // Feet on the bottom of the reserved row, not on the bottom of whatever text happens to be in
      // it — a face that rose and fell with the length of the current quip would be the same bug the
      // reserved row exists to prevent, one element further along.
      this.layoutPortrait(this.statusText.x - stackW / 2, top + stackStatusH + speechRow, hudScale)

      const actionsY = top + stackStatusH + speechRow + 12 * hudScale + this.retakeButton.height / 2
      const half = (this.retakeButton.width + 10 * hudScale + this.powerButton.width) / 2
      this.retakeButton.layout(trailing.x - half + this.retakeButton.width / 2, actionsY, hudScale)
      this.powerButton.layout(trailing.x + half - this.powerButton.width / 2, actionsY, hudScale)
      return
    }

    // Landscape: the status rides under the counter on the left, the consumables stack on the
    // right. Nothing crosses into the board's own square.
    // Landscape: the consumables live in the OTHER band, so the speech row has nothing below it to
    // collide with — but it is reserved here too, so the face stands on the same line in both
    // orientations instead of riding up and down with the current line's length.
    this.statusText.setPosition(this.speakerColumnX(this.bands.leading, statusW, scale), counterY + 60 * scale)
    this.drawStatusPlate(this.statusText.x, this.statusText.y, statusW, statusH, scale)
    const speechTop = this.statusText.y + statusH / 2 + 6 * scale
    this.layoutSpeech(this.statusText.x, speechTop, statusW, scale)
    this.layoutPortrait(this.statusText.x - statusW / 2, speechTop + SPEECH_ROW_HEIGHT * scale, scale)

    const stackGap = this.retakeButton.height + gap
    this.retakeButton.layout(trailing.x, trailing.y - stackGap / 2, scale)
    this.powerButton.layout(trailing.x, trailing.y + stackGap / 2, scale)
  }

  /**
   * Sizes the portrait HUD stack at `scale` and reports how tall the block then wants to be.
   *
   * Sizing and measuring are the same pass on purpose: the block's height IS the sum of what the
   * text and the buttons came out as, so a "pure" measurement would have to model a `Text`'s line
   * breaking rather than ask it. The caller runs this two or three times with a smaller scale until
   * the answer fits the band — see `layoutHud`'s portrait branch for why a short phone needs it.
   */
  private measureTrailingStack(scale: number): number {
    this.statusText.setFontSize(STATUS_FONT_SIZE * scale)
    // Positioned later; this call is here to make the buttons adopt the scale so their height is
    // the height this block is measured with.
    this.retakeButton.layout(0, 0, scale)
    this.powerButton.layout(0, 0, scale)

    const column = portraitWidthFor(HUD_PORTRAIT_HEIGHT * scale) + PORTRAIT_GAP * scale
    const room = Math.max(110 * scale, this.bands.trailing.width - column - 16 * scale)
    this.statusText.setWordWrapWidth(room - 28 * scale)

    return this.statusText.height + 16 * scale + SPEECH_ROW_HEIGHT * scale + 12 * scale + this.retakeButton.height
  }

  /** The status capsule. A plate rather than bare text because it sits over the background rather
   * than over the board, and unbacked text on a photographic plate is the first thing to become
   * unreadable when the skin changes. */
  private drawStatusPlate(x: number, y: number, width: number, height: number, scale: number): void {
    this.statusPlate.clear()
    this.statusPlate.fillStyle(0x2a0f40, 0.92)
    this.statusPlate.fillRoundedRect(x - width / 2, y - height / 2, width, height, 12 * scale)
    this.statusPlate.lineStyle(2 * scale, 0x5a2394, 1)
    this.statusPlate.strokeRoundedRect(x - width / 2, y - height / 2, width, height, 12 * scale)
  }

  /** DEV readout. The step count and alpha are the two numbers S3's "no judder at 120Hz" claim
   * rests on: alpha must sweep 0..1 continuously rather than sit at one value, and the step count
   * must track simulated time rather than frames drawn. */
  private updateDebugText(): void {
    // `import.meta.env.DEV` FIRST, and not merely a null check on the object.
    //
    // Guarding only the object's creation left this method's body — and every string literal in it
    // — in the shipped bundle, because a class method that is called cannot be dropped on the
    // grounds that its field is undefined. Vite substitutes `false` here, the early return becomes
    // unconditional, and everything after it is genuinely unreachable and removed.
    // `scripts/check-bundle.mjs` fails the build on the literal below if that ever stops being
    // true; it caught exactly this.
    if (!import.meta.env.DEV || !this.debugText) return
    const moving = isMoving(this.sim)
    this.debugText.setText(
      [
        `fps    ${Math.round(this.game.loop.actualFps)}`,
        `steps  ${this.stepper.steps}`,
        `alpha  ${this.stepper.alpha.toFixed(3)}`,
        `state  ${moving ? 'moving' : 'at rest'}`,
        `discs  ${liveDiscs(this.sim, 'player').length} v ${liveDiscs(this.sim, 'opponent').length}`,
        `aiming ${this.aiming ? `d${this.aiming.id}` : '—'}`,
        `rules  ${this.rules.id} / bot ${this.botLevel.id}`,
        `match  ${this.match.wins.player}-${this.match.wins.opponent}  score ${this.match.score}`,
        `branch ${this.formation} (${roundNumber(this.match)}/${MATCH_ROUNDS})  adv ${this.match.advance.player}/${this.match.advance.opponent}`,
        `search ${this.botSearch ? `${this.botSearch.progress.evaluated}/${this.botSearch.progress.total}` : '—'}`,
        `turn   ${this.round.turn} x${this.round.shotsLeft} (${this.lastResolution?.reason ?? 'start'})`,
        `round  ${this.round.winner ? `won by ${this.round.winner}` : `${this.round.shots} shots`}${this.round.lastHope ? `, lastHope ${this.round.lastHope}` : ''}`,
      ].join('\n'),
    )
  }
}

/** `'cavalry'` -> `'formationCavalry'`. Written out per branch rather than built from a template, so
 * `StringKey` still catches a typo at compile time. */
function formationKey(id: FormationId): StringKey {
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
