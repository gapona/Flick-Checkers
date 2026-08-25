import * as Phaser from 'phaser'
import { ATLAS_FRAMES, ATLAS_KEY, MENU_BACKGROUND_KEY, MUSIC_KEY, SFX } from '../assets'
import { playMusic, playSfx } from '../audio/audio'
import { coinBalance } from '../game/wallet'
import { hasSavedMatch, mascotHintNeeded, rememberMascotPoked, tutorialDone } from '../game/persistence'
import { shouldRunTour } from '../game/tour'
import type { CoachStep } from './Coach'
import { dailyStatus } from '../daily/streak'
import { dateKey } from '../daily/puzzle'
import { t, getLocale} from '../i18n/strings'
import { bindAction } from '../platform/input'
import { gameReady } from '../platform/yt'
import { anchorCenter } from '../ui/anchors'
import { fitScale } from '../ui/fit'
import { formatDayKey } from '../ui/format'
import { bindLayout } from '../ui/layout'
import { buttonHeight, gameButton, type GameButton } from '../ui/button'
import { contentColumn, createTopBar, navMarkRoot, navTo, type TopBar } from '../ui/chrome'
import { createNavBar, type NavBar } from '../ui/navBar'
import { createFlyingDiscs, type FlyingDiscs } from '../ui/flyingDiscs'
import { createMascotView, type MascotView } from '../ui/mascotView'
import { createMascotChat, type MascotChat } from '../game/mascotChat'
import { createDialogueVoice, type DialogueVoiceManager } from '../audio/dialogueVoice'
import { speechLine, SPEECH_TYPE_MS, type SpeechLine } from '../ui/speechLine'
import { BUBBLE_TAIL, createSpeechBubble, type SpeechBubble } from '../ui/speechBubble'
import { createTitleLockup, type TitleLockup } from '../ui/titleLockup'
import { getTheme } from '../ui/theme'
import { uiScale } from '../ui/uiScale'

const TITLE_FONT_SIZE = 34
const BUTTON_GAP = 16
/** Title centre to stack centre, at scale 1 — what the design asks for when there is room. */
const TITLE_STACK_GAP = 170
/** Closest the wordmark's bottom edge may come to the first button's top edge. */
const MIN_TITLE_SEPARATION = 12
/** How far the buttons may be shrunk to make the column fit before the layout gives up and lets it
 * overflow. Their TAP TARGETS do not shrink with them — `gameButton` floors every hit area at
 * `MIN_TOUCH_TARGET` whatever scale it is drawn at — so this is a question about legibility only. */
const MIN_BUTTON_SCALE = 0.62
const TITLE_SIDE_MARGIN = 24
/**
 * The mascot's height as a fraction of the viewport's shorter side, its inset from the bottom-left,
 * and the clearance it keeps from the button column.
 *
 * 0.3 and not the 0.2 it shipped at: 0.2 put it at 78px on a phone and 189px on a desktop, which
 * read as an icon rather than a character on both. 0.3 is 117px and 284px.
 */
const MASCOT_HEIGHT = 0.3
const MASCOT_MARGIN = 12
const MASCOT_COLUMN_GAP = 16
/**
 * The clearance the character keeps from the lowest button, and how far it may be shrunk to find it.
 *
 * **A short portrait phone does not have room for both**, and it was drawing them on top of each
 * other: 0.3 of the shorter side is sized off the WIDTH on any phone taller than it is wide, so the
 * character is the same 96-115px whether the band under the column is 170px or 70px. Measured, the
 * sprite crossed the Daily button by 26px at 320x568, 23px at 360x640 and 25px at 375x664 — the
 * three shapes where the stack, centred in a short band, comes down to meet it.
 *
 * **The character is what gives way**, on the same rule that drops the wordmark when the column
 * still does not fit: the row that carries no function goes first, and a decoration must never be
 * drawn over a control. It shrinks only as far as the band demands, and only when it is actually
 * under the column — in landscape the stack is off to the right and the two never meet, so nothing
 * moves there. Below {@link MASCOT_MIN_SHRINK} of its wanted height it is hidden outright rather
 * than drawn as a smudge; no viewport this game targets reaches that, which is what makes it a last
 * resort rather than a layout.
 */
const MASCOT_BUTTON_GAP = 8
const MASCOT_MIN_SHRINK = 0.55
const MASCOT_SPEECH_FONT_SIZE = 15
/** Between the tail's tip and the character it points at. */
const MASCOT_BUBBLE_GAP = 8
/** Clear of the viewport edge, and of the button column above. */
const MASCOT_BUBBLE_MARGIN = 8
/** How far down the sprite the character's eyes are — where a bubble placed beside it should point.
 * Measured off the delivered art: the hat takes the top third and the coin's widest point is just
 * below it. */
const MASCOT_FACE_FRACTION = 0.45
/** Above the drifting discs and the background, below the bars and the button column. */
const MASCOT_SPEECH_DEPTH = -700

/**
 * The hint hand: its drawn size, the point of its fingertip within the frame, and how it taps.
 *
 * The fingertip is the SPRITE's origin, so the tip lands where it is pointed rather than the picture's
 * middle — the same numbers `scenes/Coach.ts` uses, because it is the same frame doing the same job
 * and two copies of a measurement drift.
 */
const HINT_SIZE = 52
const HINT_TIP_X = 0.43
const HINT_TIP_Y = 0.02
/** How far the hand dips on a tap, in design units, and how long one tap-and-rest takes. */
const HINT_TAP_TRAVEL = 9
const HINT_TAP_PERIOD_MS = 1500
/**
 * The mascot's own voice — and it is ITS OWN, not one borrowed from the cast.
 *
 * It spoke in `burble` at first, which is the marshal's, and a character that talks in another
 * character's voice is a character the ear files as that other one. `plummy` was added to
 * `scripts/make-voice.py` for this and nobody in `game/opponents.ts` uses it: low-ish, wide-formanted
 * and almost jitter-free, because jitter is what a voice does when it is unsure of itself and this
 * one is a coin in a top hat.
 */
const MASCOT_VOICE = 'plummy' as const
/**
 * And how it speaks, which is the axis `plummy` cannot carry on its own.
 *
 * `measured` rather than `grumpy`: it is pompous, not gruff, and the deep-and-sparing cadence would
 * make a coin in a top hat sound like the marshal. Its indignation is carried by the `alarm` mood on
 * the tier-three lines instead, which is per-LINE and therefore says the right thing only when it is
 * actually cross.
 */
const MASCOT_CADENCE = 'measured' as const
const BACKGROUND_OVERSCAN = 1.04

/**
 * The entry screen, and the root of navigation.
 *
 * ## What moved off it
 *
 * It used to be a stack of six buttons. Modes and the shop are now bottom-navigation destinations
 * and settings is under the gear, which leaves the screen doing one thing: getting the player into
 * a match. That is the point of the reorganisation, not a side effect of it — a menu with six equal
 * choices has no answer to "what do I press", and the button that carries on from where the player
 * left off should be the loudest thing on screen by a wide margin.
 *
 * ## New match asks WHICH match
 *
 * It goes to `Modes` rather than into a round. It used to start one immediately, under whichever rule
 * set happened to be saved — which for a first-time player is a set they have never been shown the
 * name of, let alone the rules of. `Modes` states each set's win condition and what it does in a line,
 * so the choice is made on the screen that explains it. Continue is the only button here that still
 * starts a match outright, which is the point of Continue.
 *
 * ## Exactly one gold button, and which one it is depends on the save
 *
 * `gold` is reserved for the single primary action (`ui/button.ts`). When there is a match to
 * continue, Continue is that action and New match is `plum`; with nothing saved there is no
 * Continue at all and New match becomes the gold one. The rule is never two golds, not "Continue is
 * always gold".
 *
 * ## The daily is a deviation from the brief, and a deliberate one
 *
 * `PROMPT-UI.md`'s chunk 3 lists Continue and New match and moves everything else into the
 * navigation — but the daily puzzle (§7) is neither a mode nor a shop, and dropping its entry point
 * would delete a shipped feature. It stays here as `secondary`/`plum`, which keeps the one-gold rule
 * intact.
 */
export class MainMenu extends Phaser.Scene {
  private background!: Phaser.GameObjects.Image
  private title!: TitleLockup
  /** The menu's only moving part — see `ui/flyingDiscs.ts` for why it is code and not a picture. */
  private discs!: FlyingDiscs
  private mascot!: MascotView
  /** What it says when poked, and how fast it tires of it — `game/mascotChat.ts`. */
  private chat!: MascotChat
  private mascotSpeech!: SpeechLine
  private mascotBubble!: SpeechBubble
  private mascotVoice: DialogueVoiceManager | null = null
  /**
   * The pointing hand that says the character can be pressed, shown until it has been pressed once.
   *
   * **A moving character is not an affordance.** It bobs, tilts and blinks, and it was still
   * reported as not looking pressable — "не очевидно что он тапаемый" — which is the failure every
   * easter egg has when it is only an easter egg. The same `icon-hand` the guided tour taps controls
   * with, so a player who has just been walked round the menu already knows what a gold hand means.
   *
   * `undefined` once the save says the character has been poked, rather than merely hidden: it is
   * the only thing on this screen that exists to be retired.
   */
  private mascotHint?: Phaser.GameObjects.Image
  /** Drives the hint's tap, off the SCENE clock — see `ui/mascotView.ts` for why an idle here must
   * never be a tween. */
  /** Where `layout()` last put the hand. The tap is an offset from this, re-read every frame, so a
   * resize mid-tap moves the hand rather than stranding it. */
  private hintHome = { x: 0, y: 0 }
  private topBar!: TopBar
  private navBar!: NavBar
  private continueButton?: GameButton
  private newMatchButton!: GameButton
  private dailyButton!: GameButton
  private tutorialButton?: GameButton

  constructor() {
    super('MainMenu')
  }

  create() {
    // Cleared explicitly: a scene instance is reused across restarts, so a stale reference from a
    // visit that HAD a saved match would survive into one that does not. Same for the tutorial
    // offer, which disappears the moment the player has been through it.
    this.continueButton = undefined
    this.tutorialButton = undefined
    navMarkRoot(this)

    // The menu's own plate, not the equipped board's: a picture composed to sit behind a board
    // has its interest where a menu puts its buttons. See `assets.ts`.
    this.background = this.add.image(0, 0, MENU_BACKGROUND_KEY).setOrigin(0.5).setDepth(-1000)
    // After the background so it sits above it, before the bars and buttons so it sits below them.
    this.discs = createFlyingDiscs(this)
    this.title = createTitleLockup(this, t('gameTitle'), TITLE_FONT_SIZE)
    // Bottom-left, above the drifting discs and below the bars. Origin at its own bottom-left so
    // `layout()` can pin it to the corner without knowing how tall it is. It bobs, tilts and blinks
    // on the scene clock — see `ui/mascotView.ts`.
    this.mascot = createMascotView(this)
    // **And it answers when poked.** The three menu buttons all leave the scene, so a reaction bound
    // to one of those would play to an empty screen; the character itself is the only thing here a
    // player can press without going anywhere, which is what makes it worth pressing.
    this.mascot.image.setInteractive({ useHandCursor: true })

    // Its line goes ABOVE its head rather than beside it: the character stands in the bottom-left
    // corner, so its right is the button column and its left is the screen edge, and the only
    // direction with room on both a phone and a desktop is up.
    this.mascotBubble = createSpeechBubble(this, MASCOT_SPEECH_DEPTH)
    this.mascotSpeech = speechLine(this, this.mascotBubble.text)
    this.mascotSpeech.onEnd = () => this.mascotBubble.hide()
    this.chat = createMascotChat()

    if (mascotHintNeeded()) {
      // White art with the atlas's own dark contour, tinted gold — a flat white hand on a lit face
      // would have no edge. Depth above the character so the finger is never behind the hat.
      this.mascotHint = this.add
        .image(0, 0, ATLAS_KEY, ATLAS_FRAMES.hand)
        .setOrigin(HINT_TIP_X, HINT_TIP_Y)
        .setTint(getTheme().colors.accent)
        .setDepth(MASCOT_SPEECH_DEPTH - 1)
    }

    bindAction(this, 'pokeMascot', { pointer: this.mascot.image }, () => {
      playSfx(SFX.ui)
      this.mascot.react()
      this.sayAsMascot()
      // The hint has done its job the first time it works. Retired here rather than on a timer: a
      // player who has not pressed it yet still needs it, however long they have been looking.
      if (this.mascotHint) {
        this.mascotHint.destroy()
        this.mascotHint = undefined
        rememberMascotPoked()
      }
    })
    // **`stop()`, never `hide()`.** Phaser's `DisplayList` registers its own `SHUTDOWN` listener
    // when the scene boots — before anything `create()` registers — and destroys every game object
    // in the scene, so by the time this runs the `Text` is already gone and `setText('')` on it
    // throws from inside the shutdown handler, taking the whole game down. Same reason
    // `Game.silenceOpponent()` exists; see `ui/speechLine.ts`.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.mascotSpeech.stop()
      this.mascotVoice?.stop()
      this.mascotVoice = null
    })

    this.topBar = createTopBar(this, {
      // The root scene: no back button, and `navMarkRoot` above has already emptied the stack so a
      // stale entry from a previous visit cannot resurrect one.
      back: false,
      onSettings: () => this.openSettings(),
    })
    this.topBar.setCoins(coinBalance())

    this.navBar = createNavBar(this, 'MainMenu')

    // One-shot: starting the same scene twice mid-transition is unsafe, and the guard is shared
    // across every button here rather than per button — two different destinations pressed in the
    // same frame is the same bug as one pressed twice.
    let leaving = false
    const once = (go: () => void) => () => {
      if (leaving) return
      leaving = true
      go()
    }

    if (hasSavedMatch()) {
      this.continueButton = gameButton(this, { size: 'primary', variant: 'gold', label: t('continueMatch') })
      bindAction(
        this,
        'continueMatch',
        { pointer: this.continueButton.hitArea, keys: ['ENTER'] },
        once(() => this.scene.start('Game', { resume: true })),
      )
    }

    // **New match goes to the mode picker, not straight into a round**, and Continue is the only
    // button on this screen that still starts a match outright. A player pressing New match is
    // choosing to start something and has not yet said what — and the answer used to be silently
    // whatever they last played, which for a first-time player is a set they have never seen named.
    // `Modes` already carries each set's win condition and a line of what it does, so the choice is
    // made where it is explained rather than behind a "read the rules" link.
    this.newMatchButton = gameButton(this, {
      size: 'primary',
      variant: this.continueButton ? 'plum' : 'gold',
      label: t('newGame'),
    })
    bindAction(
      this,
      'primary',
      { pointer: this.newMatchButton.hitArea, keys: ['SPACE'] },
      once(() => navTo(this, 'Modes')),
    )

    // Labelled with the streak when there is one — a streak nobody is reminded of is a streak
    // nobody keeps — and disabled once today's is solved, so the menu says so at a glance rather
    // than making the player open it to find out.
    const daily = dailyStatus(dateKey(new Date()))
    this.dailyButton = gameButton(this, {
      size: 'secondary',
      variant: 'plum',
      /**
       * **The date until today is solved, the streak afterwards** — because the useful answer changes
       * at exactly that moment and the label has room for one of them.
       *
       * Before solving, what a player wants to know on the way past is whether the puzzle behind this
       * button is TODAY's, which is what the date says. It is `formatDayKey`'s UTC that makes that
       * honest: the day turns over at midnight UTC, so a locally-formatted date would name one day
       * and open another for anybody far enough east or west.
       *
       * After solving, the date is answering a question that has been settled — the button is
       * disabled and there is nothing behind it until tomorrow — while the streak is the thing that
       * just changed. **It shipped showing the date in both states and was reported from a phone**
       * ("не отображается сколько дней уже страйк"), by a player who had solved the puzzle, been
       * shown "1 days in a row" on the result panel, pressed Menu, and found the number gone. The
       * streak's two other homes are both INSIDE the daily, which is the one screen you cannot see
       * once you have finished with it for the day.
       */
      label: daily.solvedToday
        ? `${t('daily')} · ${t('dailyStreak', { n: daily.streak })}`
        : `${t('daily')} · ${formatDayKey(dateKey(new Date()), getLocale())}`,
    })
    this.dailyButton.setEnabled(!daily.solvedToday)
    bindAction(
      this,
      'openDaily',
      { pointer: this.dailyButton.hitArea, keys: ['D'] },
      once(() => this.scene.start('Daily')),
    )

    /**
     * The first-run offer, and the reason it is CONDITIONAL on both halves.
     *
     * A menu is a question with an answer, and for somebody who has never seen this game the answer
     * is "learn how to flick a disc", not "pick a rule set". So the tutorial is offered here — but
     * only while it has never been finished AND there is nothing to continue, which is also what
     * keeps this column at three buttons. Four would make the short-landscape case (`layout` below,
     * where the wordmark is already being dropped to fit) worse for the one player least able to
     * afford a cramped screen.
     *
     * It never becomes unreachable: the rules page lives behind the gear on every screen, and offers
     * the tutorial itself. This button is a nudge, not the door.
     *
     * `plum`, not gold: the one-gold rule holds, and the gold stays on the action that starts a
     * match. Pressing "how to play" is not what anybody should be pushed into.
     */
    if (!tutorialDone() && !this.continueButton) {
      // `tutorialPlay`, NOT `howToPlay`: this button starts the six playable LESSONS, while the same
      // words behind the gear open the reference page. Two destinations under one name is a menu
      // that lies about one of them, and the rules page already uses this key for the same door.
      this.tutorialButton = gameButton(this, { size: 'secondary', variant: 'plum', label: t('tutorialPlay') })
      bindAction(
        this,
        'openTutorial',
        { pointer: this.tutorialButton.hitArea, keys: ['H'] },
        once(() => this.scene.start('Tutorial')),
      )
    }

    playMusic(MUSIC_KEY)

    // Settings is an overlay over this scene, so the balance and the equipped skin can both change
    // while it sits paused underneath. Unbound on SHUTDOWN: `scene.events` is only cleared on
    // DESTROY, so a restarted scene would otherwise stack one more listener per visit.
    const onResume = () => this.refreshFromSave()
    this.events.on(Phaser.Scenes.Events.RESUME, onResume)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.RESUME, onResume))

    bindLayout(this, (width, height) => this.layout(width, height))

    gameReady()

    /**
     * The guided tour, on a save that has not been shown this chapter yet (`game/tour.ts`).
     *
     * AFTER `gameReady()` rather than before: the certification contract is that the game is
     * interactable, and it is — the tour is a dialog over a live menu, exactly like the settings
     * panel, and its own two buttons are the answer to it. And after `bindLayout`, which runs one
     * layout immediately, because {@link tourSteps} answers in SCREEN RECTANGLES and nothing has one
     * before that.
     *
     * `delayedCall(0)` rather than a direct launch: `create()` is still running, so this scene's
     * objects exist but the scene has not finished starting, and pausing a scene from inside its own
     * `create()` queues an operation against the one that started it.
     */
    if (shouldRunTour('menu')) this.time.delayedCall(0, () => this.openTour())
  }

  /**
   * Opens the tour over this menu — also where "Show me around" on the rules page ends up, since
   * that button only forgets the chapters and comes back here, and this check runs on the way in.
   */
  private openTour(): void {
    this.scene.pause()
    this.scene.launch('Coach', { opener: 'MainMenu', chapter: 'menu' })
  }

  /**
   * What the tour points at on this screen, in the order a new player meets it.
   *
   * Rectangles, asked for at the moment the coach opens — so a control that moved between
   * orientations simply moves the hole, and a control this screen does not carry reports nothing at
   * all. **Continue** is deliberately absent: the tour runs on a fresh save, where there is nothing
   * to continue.
   *
   * **The tutorial offer used to be absent too, and that was wrong.** The argument was that a step
   * explaining a button which disappears the moment it is used is a step that is wrong for every
   * later visit — true of a button in general, and not true of this one, because the menu chapter
   * ONLY ever runs on a save that has not seen it. That is the same save on which `tutorialDone` is
   * false and the button is therefore on screen. So the step is right on every visit the tour
   * actually makes, and leaving it out cost the one thing the tour exists to do: a player finished
   * the whole six-card tour, played a match, found the lessons later by accident and reported that
   * there was no way into them from the guide ("тут есть пробная игра обучающая, в нее не попасть
   * из изначального гайда"). It is pushed CONDITIONALLY, through the same "a step whose target has
   * no size is dropped" rule every other optional step here uses.
   *
   * Second in the order, not last: it is the answer to "I have never played this", and a card
   * offering the lessons after five cards about shops and rule sets has already lost the person it
   * was written for.
   */
  tourSteps(): CoachStep[] {
    const steps: CoachStep[] = [
      // `gameTitle`, not a second copy of the name: the tour's opening card and the wordmark it is
      // drawn over must say the same thing, and two keys holding one name is two keys that can
      // drift. (They already had — this one held the working name the design doc uses, which is
      // what the game is to the people building it and not what it is called to the player.)
      { target: null, title: 'gameTitle', body: 'coachHelloBody' },
    ]
    if (this.tutorialButton) {
      steps.push({ target: this.tutorialButton.container.getBounds(), title: 'coachTutorialTitle', body: 'coachTutorialBody' })
    }
    steps.push(
      { target: this.newMatchButton.container.getBounds(), title: 'coachPlayTitle', body: 'coachPlayBody' },
      { target: this.dailyButton.container.getBounds(), title: 'coachDailyTitle', body: 'coachDailyBody' },
    )
    const shop = this.navBar.tabBounds('Shop')
    if (shop) steps.push({ target: shop, title: 'coachShopTitle', body: 'coachShopBody' })
    const modes = this.navBar.tabBounds('Modes')
    if (modes) steps.push({ target: modes, title: 'coachModesTitle', body: 'coachModesBody' })
    // The bar as ONE step rather than two: the balance is at its left end and the gear at its right,
    // so two spotlights would be two holes in the same 72-unit strip with the same sentence under
    // them. What the player needs to know is that the strip is where both live.
    const bar = this.topBar.parts()
    if (bar.balance) {
      const left = Math.min(bar.balance.x, bar.settings.x)
      const right = Math.max(bar.balance.right, bar.settings.right)
      const top = Math.min(bar.balance.y, bar.settings.y)
      const bottom = Math.max(bar.balance.bottom, bar.settings.bottom)
      steps.push({ target: { x: left, y: top, width: right - left, height: bottom - top }, title: 'coachBarTitle', body: 'coachBarBody' })
    }
    return steps
  }

  private openSettings(): void {
    this.scene.pause()
    this.scene.launch('Settings', { opener: 'MainMenu' })
  }

  private refreshFromSave(): void {
    this.topBar.setCoins(coinBalance())
    // The background is NOT re-read here any more: the menu wears its own plate rather than the
    // equipped board's, so there is nothing about it for a save change to alter. The equipped skin
    // still shows on this screen — on the drifting discs and in the title lockup, both of which
    // read it live.
    this.layout(this.scale.width, this.scale.height)
  }

  update(time: number, delta: number): void {
    this.discs.update(delta)

    /**
     * The hint's tap, on the SCENE clock rather than on a tween — the rule `ui/mascotView.ts` states
     * and this screen has to keep: the TweenManager does not stop with the scene, so a tweened idle
     * goes on tapping underneath an open Settings panel and the guided tour's own scrim.
     *
     * One dip per period with a long rest between, rather than a continuous bounce: a hand that never
     * stops moving reads as decoration, and what this has to say is "press here", once, repeatedly.
     */
    if (this.mascotHint) {
      const phase = (time % HINT_TAP_PERIOD_MS) / HINT_TAP_PERIOD_MS
      const dip = phase < 0.34 ? Math.sin(phase / 0.34 * Math.PI) : 0
      this.mascotHint.setY(this.hintHome.y + dip * HINT_TAP_TRAVEL * uiScale(this.scale.width))
    }
  }

/**
   * The bubble: above the character's head where there is room for it, beside the head where there
   * is not.
   *
   * **A bubble must never cover a control**, which is the whole reason this is not one line. The
   * mascot stands under the button column, and the band between its hat and the lowest button is not
   * always big enough: measured, 104px on a 430x932 phone but 55px on a 360x780 and **34px on a
   * 320x700, against a bubble 42px tall**. Clamping downward cannot fix that — there is genuinely
   * nowhere above the head to put it — so when the band is too small the bubble goes to the RIGHT of
   * the head instead, into the space the column has already ended above. The tail follows, which is
   * what `BubbleEdge`'s four sides are for.
   *
   * The tail's own reach counts toward the fit. Leaving it out of the arithmetic is how the first
   * version cleared the column by four pixels on one phone and overlapped it by three on another.
   *
   * **Anchored to the mascot's REST position, not to where the bob currently has it.** A bubble that
   * followed the breathing would need redrawing every frame — a `Graphics.clear()` and six draw calls
   * at 60fps for a wobble of a few pixels — and at that amplitude the tail and the head read as
   * connected anyway. Redrawn only as the line types, and as `layout()` moves things.
   */
  private drawMascotBubble(): void {
    // A screen too short to draw the character is a screen with nobody to speak, and a bubble with
    // no speaker under it reads as a stray plate — see {@link MASCOT_BUTTON_GAP}.
    if (!this.mascotSpeech.line || !this.mascot.image.visible) {
      this.mascotBubble.hide()
      return
    }

    const scale = uiScale(this.scale.width)
    const { width, height } = this.mascotBubble.size(scale)
    const tail = BUBBLE_TAIL * scale
    const margin = MASCOT_BUBBLE_MARGIN * scale
    const head = { x: this.mascot.image.x + this.mascot.width / 2, y: this.mascot.image.y - this.mascot.height }

    // The lowest edge of anything the player can press, which is what the bubble has to stay under.
    const buttons = [this.continueButton, this.newMatchButton, this.tutorialButton, this.dailyButton].filter(
      (button): button is GameButton => button !== undefined,
    )
    const floor = buttons.reduce((lowest, button) => Math.max(lowest, button.container.y + button.height / 2), 0)

    const clampX = (x: number): number =>
      Phaser.Math.Clamp(x, margin, Math.max(margin, this.scale.width - width - margin))

    // Above, if the whole bubble AND its tail fit between the buttons and the hat.
    const above = head.y - MASCOT_BUBBLE_GAP * scale - tail - height
    if (above >= floor + margin) {
      this.mascotBubble.draw(clampX(head.x - width / 2), above, head, 'bottom', scale)
      return
    }

    // Otherwise beside it, and level with the FACE rather than the top of the sprite. Aiming at the
    // sprite's top corner put the bubble beside the hat, which is the narrowest part of the picture —
    // the tail then reached across a hand's width of empty background and the whole thing read as
    // detached from the character. The coin is at its widest at the eyes, which is where a bubble
    // belongs anyway.
    const face = { x: head.x, y: head.y + this.mascot.height * MASCOT_FACE_FRACTION }
    const left = clampX(head.x + this.mascot.width / 2 + tail + MASCOT_BUBBLE_GAP * scale)
    const top = Math.max(floor + margin, face.y - height / 2)
    this.mascotBubble.draw(left, top, face, 'left', scale)
  }

  /** One poke's worth of talking. There is always a line — see `game/mascotChat.ts` on why even the
   * sulk answers rather than falling silent. */
  private sayAsMascot(): void {
    const remark = this.chat.poke(this.time.now)
    this.mascotVoice?.stop()
    const voice = createDialogueVoice(MASCOT_VOICE, MASCOT_CADENCE, SPEECH_TYPE_MS)
    voice.begin(remark.line, remark.mood)
    this.mascotVoice = voice
    // Redrawn per revealed character: the plate is fitted to the text and the text grows as it
    // types, so a plate drawn once would be a bubble at full size around one letter.
    this.mascotSpeech.onGlyph = (_revealed, _total, char, end) => {
      voice.playLetterSound(char, end)
      this.drawMascotBubble()
    }
    this.mascotSpeech.say(remark.line)
    this.drawMascotBubble()
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)

    const cover = Math.max(width / this.background.width, height / this.background.height) * BACKGROUND_OVERSCAN
    this.background.setPosition(width / 2, height / 2).setScale(cover)

    this.topBar.layout(width, height)
    this.navBar.layout(width, height)

    // `uiScale` alone cannot keep a title on screen: it floors at 0.8 and knows nothing about how
    // wide a particular string renders.
    // Measured on the WHOLE lockup, discs included: fitting the wordmark alone would let the discs
    // hang off a narrow phone, which is the one place they are most likely to.
    this.discs.layout(width, height)
    this.title.setFontSize(TITLE_FONT_SIZE * scale)
    this.title.setFontSize(TITLE_FONT_SIZE * scale * fitScale(this.title.width, width - TITLE_SIDE_MARGIN * 2))

    // The stack is centred in what is left between the two bars, not in the viewport — otherwise
    // the navigation eats into it from below and the column sits visibly high.
    const top = this.topBar.height(this)
    const bottom = this.navBar.height(this)
    const centreY = top + (height - top - bottom) / 2

    // The title is positioned at the very end, once the column below it has been measured — see
    // `fitColumn` at the bottom of this method.

    // The mascot is placed AFTER the stack, at the bottom of this method: where it may stand
    // depends on where the lowest button ended up, and that is not known until the band has been
    // solved. It used to be laid out here, above the stack, which is also why the bubble's own
    // floor test was reading the PREVIOUS pass's button positions.

    // Order is reading order and it is the stack's order: continue or start, then learn, then the
    // daily. The bubble's floor test below reads the SAME array, which is why both places build it
    // from one expression rather than two lists that can disagree about what is on screen.
    const buttons = [this.continueButton, this.newMatchButton, this.tutorialButton, this.dailyButton].filter(
      (b): b is GameButton => b !== undefined,
    )

    /**
     * **The whole column — wordmark, gap, buttons — has to fit between the two bars, and in short
     * landscape it does not.** What shipped centred the STACK on the band and hung the title a
     * fixed 170 above it, which is two independent placements and neither of them looks at the
     * band's edges. Measured: at 640x320 the wordmark ran 25px ABOVE the top of the screen and the
     * Daily button 11px INTO the navigation bar; at 740x360 the wordmark was clipped by 5px.
     *
     * The band cannot always be satisfied by moving things: two 'primary' buttons plus their gap
     * are 162px against a 136px band at 640x320, so the buttons are also allowed to shrink. Their
     * tap targets are not affected — `gameButton` floors every hit area at `MIN_TOUCH_TARGET`
     * however small the button is drawn — so this costs legibility, not reachability.
     *
     * **Nothing moves on a screen that already fits.** The default placement is computed first and
     * used as-is unless it breaks the band, so every portrait phone and every desktop window keeps
     * the layout it had; only the shapes that were broken are re-solved.
     */
    const bandTop = top
    const bandBottom = height - bottom
    const titleH = this.title.height
    const stackHeightAt = (s: number): number =>
      buttons.length * buttonHeight('primary', s) + (buttons.length - 1) * BUTTON_GAP * s

    let logo = true
    let buttonScale = scale
    let stackH = stackHeightAt(buttonScale)
    let titleGap = TITLE_STACK_GAP * scale
    let titleCentre = centreY - titleGap
    let stackCentre = centreY

    const fits = (): boolean =>
      titleCentre - titleH / 2 >= bandTop && stackCentre + stackH / 2 <= bandBottom
    if (!fits()) {
      // Shrink the buttons only as far as the band actually demands, and only after the gap has
      // given up everything it can.
      const room = bandBottom - bandTop - titleH - MIN_TITLE_SEPARATION * scale
      if (stackH > room) {
        buttonScale = Math.max(MIN_BUTTON_SCALE * scale, buttonScale * (room / stackH))
        stackH = stackHeightAt(buttonScale)
      }
      const wantedSeparation = TITLE_STACK_GAP * scale - titleH / 2 - stackH / 2
      const separation = Math.min(
        Math.max(MIN_TITLE_SEPARATION * scale, wantedSeparation),
        Math.max(MIN_TITLE_SEPARATION * scale, bandBottom - bandTop - titleH - stackH),
      )
      const columnH = titleH + separation + stackH
      const columnTop = bandTop + Math.max(0, (bandBottom - bandTop - columnH) / 2)
      titleCentre = columnTop + titleH / 2
      stackCentre = columnTop + titleH + separation + stackH / 2

      // **And if it STILL does not fit, the logo goes.** At 640x320 the two buttons alone are
      // taller than the band even shrunk to `MIN_BUTTON_SCALE`, so something has to leave the
      // screen and it must not be a control. Same rule as `Modes` dropping its section heading:
      // the row that carries no function is the one that goes first. Below this size the menu is
      // buttons and a mascot, which is all it needs to be.
      logo = columnH <= bandBottom - bandTop
      if (!logo) stackCentre = bandTop + (bandBottom - bandTop) / 2
    }

    this.title.setVisible(logo)
    this.title.layout(width / 2, titleCentre)

    const step = buttonHeight('primary', buttonScale) + BUTTON_GAP * buttonScale
    let offset = stackCentre - ((buttons.length - 1) * step) / 2
    for (const button of buttons) {
      button.layout(width / 2, offset, buttonScale)
      offset += step
    }

    this.layoutMascot(width, height, scale, bottom, buttons)
  }

  /**
   * The character, its bubble's metrics and its hit area — placed against the button stack, so it
   * runs after the stack has been laid out.
   *
   * Sized off the SHORTER side, like the drifting discs, so it neither dominates a phone nor shrinks
   * to a sticker on a desktop, and sat on the nav bar's top edge — then capped so it never reaches
   * the buttons. See {@link MASCOT_BUTTON_GAP} for why the cap is needed and why the character is
   * what gives way.
   */
  private layoutMascot(width: number, height: number, scale: number, bottom: number, buttons: GameButton[]): void {
    const wanted = Math.min(width, height) * MASCOT_HEIGHT

    // **Anchored to the button column, not to the screen edge**, which is one rule that gives the
    // right answer on both shapes. `contentColumn` is capped at 720, so on a wide desktop the
    // column is centred with hundreds of px of empty margin either side and pinning the mascot to
    // the far left left it marooned in a corner; parking it just outside the column instead brings
    // it in beside the buttons. On a phone the column already spans the viewport, the subtraction
    // goes negative, and the clamp puts it back against the edge — which is where it belongs there.
    const columnLeft = (width - contentColumn(width)) / 2
    const restX = (mascotWidth: number): number =>
      Math.max(MASCOT_MARGIN * scale, columnLeft - MASCOT_COLUMN_GAP * scale - mascotWidth)

    const feet = height - bottom - MASCOT_MARGIN * scale
    const gap = MASCOT_BUTTON_GAP * scale

    // Only a character that stands UNDER the column can be crossed by it. In landscape the stack is
    // off to the right with the whole left of the screen to itself, and capping it there would
    // shrink a character nothing is near.
    this.mascot.setHeight(wanted)
    const stackLeft = buttons.reduce((left, button) => Math.min(left, button.container.x - button.width / 2), width)
    const under = restX(this.mascot.width) + this.mascot.width + gap > stackLeft
    const room = buttons.reduce((low, button) => Math.max(low, button.container.y + button.height / 2), 0)

    const capped = under ? Math.min(wanted, feet - room - gap) : wanted
    this.mascot.image.setVisible(capped >= wanted * MASCOT_MIN_SHRINK)
    this.mascot.setHeight(Math.max(capped, wanted * MASCOT_MIN_SHRINK))

    const mascotWidth = this.mascot.width
    this.mascot.setRest(restX(mascotWidth), feet)

    // Wrapped to a column a bit wider than the character, so a two-line quip still reads as coming
    // from the face under it rather than from the screen edge.
    this.mascotBubble.setMetrics(
      MASCOT_SPEECH_FONT_SIZE * scale,
      Math.min(width - 32 * scale, Math.max(mascotWidth * 1.6, 180 * scale)),
    )
    this.drawMascotBubble()
    // The hit area follows the drawn size, and it has to be re-set rather than re-`setInteractive`d
    // — calling that again only re-enables input, it does not recompute the geometry (CLAUDE.md
    // "Responsive Layout", gotcha #2).
    const area = this.mascot.image.input?.hitArea as Phaser.Geom.Rectangle | undefined
    area?.setTo(0, 0, this.mascot.image.width, this.mascot.image.height)

    // The fingertip lands on the FACE, not on the sprite's box: the hat is the top third of the
    // picture and a hand pointing at it points at a hat. `MASCOT_FACE_FRACTION` is the same number
    // the bubble aims at, for the same reason.
    if (this.mascotHint) {
      this.mascotHint.setVisible(this.mascot.image.visible)
      // Sized against the CHARACTER as well as the viewport: the mascot is capped by the button
      // column on a short phone (see above), and a fixed-size hand on a shrunken character is a hand
      // holding a coin rather than a hand pointing at one.
      const size = Math.min(HINT_SIZE * scale, this.mascot.height * 0.55)
      this.mascotHint.setScale(size / this.mascotHint.height)
      // The fingertip touches the character's right EDGE at face height, so the hand hangs into the
      // empty background beside it. Aimed at the face rather than the sprite's box for the reason the
      // bubble is: the hat is the top third of the picture, and a finger level with it points at a hat.
      // Placed just OUTSIDE rather than on the face — the first version put the tip mid-cheek and the
      // hand covered the half of the character it was drawing attention to.
      this.hintHome = {
        x: restX(mascotWidth) + mascotWidth * 0.98,
        y: feet - this.mascot.height * (1 - MASCOT_FACE_FRACTION),
      }
      this.mascotHint.setPosition(this.hintHome.x, this.hintHome.y)
    }
  }
}
