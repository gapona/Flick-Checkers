import * as Phaser from 'phaser'
import { isOpponentUnlocked, opponent, opponentIndex, OPPONENTS } from '../game/opponents'
import { createDialogueVoice, type DialogueVoiceManager } from '../audio/dialogueVoice'
import { speechLine, SPEECH_TYPE_MS, type SpeechLine } from '../ui/speechLine'
import { reactPortrait } from '../ui/portrait'
import { currentOpponent, defeatedOpponents, rememberOpponent } from '../game/persistence'
import type { RulesId } from '../game/rules'
import { t, type StringKey } from '../i18n/strings'
import { bindAction } from '../platform/input'
import { isPlatformPaused, YTEvents } from '../platform/yt'
import { gameButton, type GameButton } from '../ui/button'
import { getDisplayFontStack } from '../ui/font'
import { bindLayout } from '../ui/layout'
import { createOverlay, OVERLAY_PANEL_FILL, type Overlay } from '../ui/overlay'
import { makePortrait, placePortrait, portraitWidthFor } from '../ui/portrait'
import { createSpeechBubble, type SpeechBubble } from '../ui/speechBubble'
import { listHeightBetween, scrollableCameraRegion, type ScrollableCameraRegion } from '../ui/scrollRegion'
import { computeReleaseVelocity, createScrollMomentumState, pushDragSample, resetScrollMomentum, stepMomentum, type ScrollMomentumState } from '../ui/scrollMomentum'
import { uiScale } from '../ui/uiScale'
import { raiseOverlay } from '../platform/lifecycle'

export interface OpponentsData {
  /** The scene to resume when this closes without starting anything. */
  opener: string
  /** The rule set already chosen on the screen underneath — named in the panel's subtitle, because
   * step two of a two-step choice has to say what step one settled. */
  rules: RulesId
  /** Runs once a character has been picked and the player has asked to start. The panel has already
   * closed and the opener has already been resumed by then — same contract as `MatchResult`. */
  onStart: () => void
  /**
   * Runs instead when the player backs out — Close, ESC, or a tap on the scrim.
   *
   * Optional because the ordinary opener needs nothing: `Modes` is a live screen and resuming it IS
   * the right answer. It exists for an opener that is NOT somewhere a player can be left. Winning a
   * match opens this panel over the finished board, and backing out of it there used to resume a
   * `Game` whose match was already over — a screen that accepts no shot and offers no exit, which is
   * the same "it freezes after you win" dead end the daily had.
   */
  onCancel?: () => void
}

/** Clear of the viewport edge on every side. */
const VIEWPORT_MARGIN = 16
const PANEL_PAD = 20
/** A popup wider than this stops reading as a dialog and starts reading as a page. */
const PANEL_MAX_WIDTH = 460

const TITLE_FONT_SIZE = 20
const SUBTITLE_FONT_SIZE = 13
const CARD_TITLE_FONT_SIZE = 17
const CARD_ABOUT_FONT_SIZE = 12

const CARD_MIN_HEIGHT = 78
const CARD_GAP = 10
const CARD_PADDING = 12
const CARD_RADIUS = 12
/**
 * A character's drawn height on its card.
 *
 * **The picture is the point of this screen**, so it gets the room: the cast is eight faces a player
 * is meant to recognise and remember, and at the 84 this shipped with they were thumbnails beside a
 * paragraph. The cost is real and worth knowing — the portrait's column comes out of the text's, so
 * a taller face wraps the description onto more lines and every card grows. Measured at 390px wide:
 * 84 left 186px for the text, 112 leaves 166.
 */
const PORTRAIT_HEIGHT = 112
/** A locked character is the same portrait, dimmed — not a silhouette and not an empty box. */
const LOCKED_ALPHA = 0.4

/** The plate the portrait stands on. It IS `CARD_FILL` — the frames were rendered on that colour —
 * and it is named separately so the two cannot drift into disagreeing. */
const PORTRAIT_SLOT_FILL = 0x241040
const PORTRAIT_SLOT_RADIUS = 8

const CARD_FILL = 0x241040
const CARD_FILL_SELECTED = 0x33195c
const CARD_STROKE = 0x5a2394
const CARD_STROKE_SELECTED = 0xffc23c
const ACCENT = 0xffc23c
const CHECK_COLOR = '#ffc23c'
/** The picked character's bubble. Everything about how it LOOKS is `ui/speechBubble.ts`; these are
 * the numbers this screen places it with. */
const BUBBLE_FONT_SIZE = 13
const BUBBLE_PAD = 9
/** Has to match `ui/speechBubble.ts`'s own tail, which the placement has to leave room for. */
const BUBBLE_TAIL = 7
/** Between the tail's tip and the card it points at. */
const BUBBLE_GAP = 2
/** Over the cards, under nothing — the cards are created after it in the same display list. */
const BUBBLE_DEPTH = 20
const LABEL_COLOR = '#e6d8f5'
const MUTED_COLOR = '#a892c4'

const SCROLLBAR_WIDTH = 4
const SCROLLBAR_GAP = 5
const SCROLLBAR_MIN_THUMB = 24
const SCROLLBAR_TRACK_ALPHA = 0.18
const SCROLLBAR_THUMB_ALPHA = 0.75

/** The list fades in with the panel rather than sitting at full size inside a frame that is still
 * springing. The region is a CAMERA, so it cannot be a child of the panel container and cannot
 * inherit its scale — an alpha tween is the one property the two can share. */
const REVEAL_MS = 220

interface Card {
  id: string
  plate: Phaser.GameObjects.Graphics
  portrait: Phaser.GameObjects.Image
  title: Phaser.GameObjects.Text
  about: Phaser.GameObjects.Text
  /** What unlocks this one, shown only while it is locked. */
  status: Phaser.GameObjects.Text
  check: Phaser.GameObjects.Text
  hit: Phaser.GameObjects.Rectangle
  unlocked: boolean
}

/**
 * **Step two: who you are playing.**
 *
 * The mode and the opponent used to be one scrolling list on `Modes` — four rule-set cards with
 * the whole cast underneath them, ~970px of scroll on a desktop and rather more on a phone. Two
 * different questions in one column reads as one long list of unrelated cards, and the second half
 * of it was below the fold on every device the game targets, so the ladder — the thing the whole
 * cast exists for — was the part nobody saw. Splitting them makes each screen answer one question,
 * and makes the ORDER explicit: you pick how the game is played, then who you are playing it
 * against, and the popup names the mode you settled so the two never come apart.
 *
 * ## Why a popup and not a third navigation destination
 *
 * Because it is a step, not a place. The mode list stays visible behind the scrim, which is what
 * says "this is still the same decision"; closing puts you back on it with nothing lost. A nav
 * destination would also carry the bottom tab bar, and a tab bar in the middle of a two-step flow
 * is an invitation to leave it half-finished.
 *
 * ## The clipping, which is the only awkward part
 *
 * Eight characters do not fit a dialog, so the list scrolls, and a scrolling list here has to clip
 * through a dedicated camera's viewport (`setMask()` is a silent no-op under this renderer — see
 * CLAUDE.md "Scroll Patterns"). A later camera OWNS its viewport's pixels rather than compositing
 * over them, so the overlay's own plate is simply absent inside the list's rectangle — which is why
 * the region camera is given {@link OVERLAY_PANEL_FILL} as its background. Everything else the
 * panel draws is kept strictly outside that rectangle.
 */
export class Opponents extends Phaser.Scene {
  /** Named `request`, not `data` — `Phaser.Scene.data` is the scene's own `DataManager`. */
  private request!: OpponentsData
  private overlay!: Overlay
  private region!: ScrollableCameraRegion

  private title!: Phaser.GameObjects.Text
  private subtitle!: Phaser.GameObjects.Text
  private note!: Phaser.GameObjects.Text
  /**
   * What the character you just tapped has to say, in a bubble beside its own face.
   *
   * **It lives in the scroll REGION, not on the panel**, because it belongs to a card rather than to
   * the dialog: it is positioned in list coordinates, scrolls with the cards, and is clipped by the
   * same viewport they are. It first went in the note's row at the top of the panel and that was
   * wrong twice over — it covered a line of text that was still saying something useful, and a quip
   * printed at the far end of the dialog from the face that said it does not read as that face
   * speaking.
   *
   * Drawn ABOVE the card, tail pointing down at the portrait, so it never covers the character's own
   * description. Below it instead when the card is too near the top of the list for a bubble to fit
   * above — see {@link Opponents.drawBubble}.
   */
  private bubble!: SpeechBubble
  /** The card currently speaking, so a resize or a scroll can redraw the bubble where it belongs. */
  private speaking: Card | null = null
  private speech!: SpeechLine
  private voice: DialogueVoiceManager | null = null
  /** Which of a character's picker lines comes next, per character. Rotating rather than random for
   * the reason everything else in this game rotates: with three alternatives a uniform pick repeats
   * about a third of the time. */
  private saidCursor = new Map<string, number>()
  private startButton!: GameButton
  private closeButton!: GameButton
  private scrollbar!: Phaser.GameObjects.Graphics
  private scrollbarTrack = { x: 0, width: 0, height: 0 }

  private cards: Card[] = []
  private chosen = ''
  /** The list's full height in region coordinates — written by {@link Opponents.layoutCards}, read
   * by `layout()` a line later to size the scroll. */
  private contentHeight = 0

  private scrollState!: ScrollMomentumState
  private scrollY = 0
  private maxScroll = 0
  private dragging = false
  private dragOrigin = 0
  private scrollOrigin = 0

  private leaving = false

  constructor() {
    super('Opponents')
  }

  create(data: OpponentsData) {
    // Above every other scene, whatever order `config.ts` registered them in — see
    // `raiseOverlay`, and the four dead buttons that came of not doing this.
    raiseOverlay(this)

    // Phaser re-uses the scene instance, so every field a `create()` writes is cleared here first.
    // `MatchResult` shipped without this and hung the game on the second panel of a session.
    this.request = data
    this.cards = []
    this.scrollY = 0
    this.maxScroll = 0
    this.dragging = false
    this.leaving = false
    this.scrollState = createScrollMomentumState()
    this.chosen = currentOpponent().id

    this.overlay = createOverlay(this, { onDismiss: () => this.cancel() })

    this.title = this.add
      .text(0, 0, t('opponentsTitle'), { fontFamily: getDisplayFontStack(), fontSize: TITLE_FONT_SIZE, color: LABEL_COLOR })
      .setOrigin(0.5)
    // Step one's answer, restated. Without it the popup is a list of faces with no bearing on what
    // was just chosen, and a player who mis-tapped a mode has no way to notice before starting.
    this.subtitle = this.add
      .text(0, 0, t('opponentsMode', { name: t(ruleNameKey(data.rules)) }), {
        fontFamily: 'Arial',
        fontSize: SUBTITLE_FONT_SIZE,
        color: CHECK_COLOR,
      })
      .setOrigin(0.5)
    this.note = this.add
      .text(0, 0, t('opponentNote'), { fontFamily: 'Arial', fontSize: SUBTITLE_FONT_SIZE, color: MUTED_COLOR, align: 'center' })
      .setOrigin(0.5, 0)
    // Depth rather than creation order: the bubble has to sit over the cards, and the cards are
    // created after this in the same display list.
    this.bubble = createSpeechBubble(this, BUBBLE_DEPTH)
    this.speech = speechLine(this, this.bubble.text)
    // Redrawn per revealed character: the plate is fitted to the text, and the text grows as it
    // types. One redraw per 42ms of typing is nothing, and the alternative — a plate sized for the
    // finished line — is a bubble that appears at full size around one letter.
    this.speech.onGlyph = null
    this.speech.onEnd = () => {
      this.speaking = null
      this.bubble.hide()
    }

    const defeated = defeatedOpponents()
    for (const one of OPPONENTS) {
      const plate = this.add.graphics()
      const portrait = makePortrait(this, one.id, PORTRAIT_HEIGHT)
      const title = this.add
        .text(0, 0, t(one.nameKey), { fontFamily: getDisplayFontStack(), fontSize: CARD_TITLE_FONT_SIZE, color: LABEL_COLOR })
        .setOrigin(0, 0)
      const about = this.add
        .text(0, 0, t(one.descKey), { fontFamily: 'Arial', fontSize: CARD_ABOUT_FONT_SIZE, color: MUTED_COLOR, wordWrap: { width: 200 } })
        .setOrigin(0, 0)
      const status = this.add
        .text(0, 0, '', { fontFamily: 'Arial', fontSize: CARD_ABOUT_FONT_SIZE, color: CHECK_COLOR, wordWrap: { width: 200 } })
        .setOrigin(0, 0)
      const check = this.add.text(0, 0, '✓', { fontFamily: 'Arial', fontSize: 20, color: CHECK_COLOR }).setOrigin(1, 0.5)
      const hit = this.add.rectangle(0, 0, 100, CARD_MIN_HEIGHT, 0x000000, 0).setInteractive({ useHandCursor: true })
      bindAction(this, `pickOpponent:${one.id}`, { pointer: hit }, () => this.pick(one.id))
      this.cards.push({ id: one.id, plate, portrait, title, about, status, check, hit, unlocked: isOpponentUnlocked(one.id, defeated) })
    }

    this.startButton = gameButton(this, { size: 'secondary', variant: 'gold', label: t('newGame') })
    this.closeButton = gameButton(this, { size: 'secondary', variant: 'ghost', label: t('back') })
    bindAction(this, 'opponentsStart', { pointer: this.startButton.hitArea, keys: ['ENTER', 'SPACE'] }, () => this.start())
    bindAction(this, 'opponentsClose', { pointer: this.closeButton.hitArea, keys: ['ESC'] }, () => this.cancel())

    for (const object of [this.title, this.subtitle, this.note, this.startButton.container, this.closeButton.container]) {
      this.overlay.panel.add(object)
    }

    // **`stop()`, never `hide()`.** Phaser's `DisplayList` destroys every game object in the scene on
    // `SHUTDOWN` before anything `create()` registered runs, so `setText` from here throws and takes
    // the game down with it. See `ui/speechLine.ts`.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.speech.stop()
      this.voice?.stop()
      this.voice = null
    })

    // Added after the main camera, so it composites on top of the scrim and the plate — and owns
    // its own rectangle outright, which is why it carries the panel's fill as its background.
    this.region = scrollableCameraRegion(this, { x: 0, y: 0, width: 1, height: 1 })
    this.region.camera.setBackgroundColor(OVERLAY_PANEL_FILL)
    this.region.camera.setAlpha(0)
    this.scrollbar = this.add.graphics()
    this.bindScroll()

    bindLayout(this, (width, height) => this.layout(width, height))
    this.overlay.open()
    this.tweens.add({ targets: this.region.camera, alpha: 1, duration: REVEAL_MS })
    // A character already scrolled past on entry is a character the player has to go looking for.
    this.scrollToChosen()
  }

  /**
   * Drag-to-scroll, with the pointer event's own timestamp — several raw moves can land inside one
   * `update()` tick, and sharing a clock between them corrupts the release velocity in a way that
   * depends on how the render rate lines up with the input rate.
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
    if (this.dragging || this.scrollState.velocity === 0) return
    this.scrollY = stepMomentum(this.scrollState, this.scrollY, delta, 0, this.maxScroll, time)
    this.region.camera.setScroll(0, this.scrollY)
    this.drawScrollbar()
  }

  /** **A locked card is shown, dimmed, with what unlocks it — never hidden, and never selectable.**
   * A locked character IS the progression: a player who cannot see the marshal has no reason to
   * beat the sniper. */
  private pick(id: string): void {
    const card = this.cards.find((one) => one.id === id)
    if (!card) return

    // **A locked character still answers — with its face.** A tap that does nothing at all is
    // indistinguishable from a tap that missed, and this one has not missed: the card says what
    // unlocks it, and a flinch is the acknowledgement that makes a player look at that line.
    if (!card.unlocked) {
      reactPortrait(this, card.portrait, 'alarm')
      return
    }

    this.chosen = id
    rememberOpponent(id)
    this.layout(this.scale.width, this.scale.height)
    this.sayAs(card)
  }

  /**
   * The character sizes you up.
   *
   * Not rate-limited, unlike everything `game/speech.ts` governs: that limit exists because a
   * character commenting on every shot becomes a stream of text over a board the player is trying to
   * read. This is a deliberate tap on a face, and the line IS the answer to it.
   *
   * `calm` for all twelve. The mood is a pitch contour, and `calm` is the one that reads as ordinary
   * speech — a picker full of characters announcing themselves in `triumph` would be twelve
   * characters shouting.
   */
  private sayAs(card: Card): void {
    const character = opponent(card.id)
    if (!character) return
    const lines = character.lines.onPicked
    if (!lines || lines.length === 0) return

    const index = (this.saidCursor.get(card.id) ?? -1) + 1
    this.saidCursor.set(card.id, index)
    const line = lines[index % lines.length]

    reactPortrait(this, card.portrait, 'calm')
    this.voice?.stop()
    const voice = createDialogueVoice(character.voice, character.cadence, SPEECH_TYPE_MS)
    voice.begin(line, 'calm')
    this.voice = voice
    this.speaking = card
    this.speech.onGlyph = (_revealed, _total, char, end) => {
      voice.playLetterSound(char, end)
      this.drawBubble()
    }
    this.speech.say(line)
    this.drawBubble()
  }

  private start(): void {
    if (this.leaving) return
    this.leaving = true
    this.close(this.request.onStart)
  }

  /**
   * Brings the current pick into view on entry — by the SHORTEST move, and not at all if it is
   * already on screen.
   *
   * Scrolling to put the chosen card at the top regardless would push the characters above it off
   * the list on entry, which on a ladder is the wrong half to hide: the ones before your current
   * rung are the ones you have already beaten and might want back. No animation, because the panel
   * is still springing and a list that also slides reads as two things moving for no reason.
   */
  private scrollToChosen(): void {
    const card = this.cards.find((one) => one.id === this.chosen)
    if (!card || this.maxScroll <= 0) return

    // Positions are only known after the first `layout()`, which `bindLayout` has already run.
    const top = card.hit.y - card.hit.height / 2
    const bottom = card.hit.y + card.hit.height / 2
    const view = this.scrollbarTrack.height
    const margin = CARD_GAP

    if (top < this.scrollY + margin) this.scrollY = top - margin
    else if (bottom > this.scrollY + view - margin) this.scrollY = bottom - view + margin
    else return

    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScroll)
    this.region.camera.setScroll(0, this.scrollY)
    this.drawScrollbar()
  }

  /**
   * The bubble, fitted around whatever of the line has been typed so far.
   *
   * Positioned in LIST coordinates — the same space the cards are laid out in — so it scrolls with
   * the card it belongs to and needs no per-frame follow. Anchored to the portrait's column and its
   * top edge, with the tail pointing down at the face; flipped below the card when there is no room
   * above, which is the case for the first card in the list and for any card scrolled near the top.
   */
  private drawBubble(): void {
    const card = this.speaking
    if (!card || !this.speech.line) {
      this.bubble.hide()
      return
    }

    const scale = uiScale(this.scale.width)
    const cardTop = card.hit.y - card.hit.height / 2
    const cardBottom = card.hit.y + card.hit.height / 2
    const { height } = this.bubble.size(scale)

    // Left-aligned with the portrait's own column, so the bubble and the face share an edge, and
    // clear of the card by a hair so the tail reads as touching it rather than growing out of it.
    const left = card.portrait.x - card.portrait.displayWidth / 2
    const above = cardTop - BUBBLE_GAP * scale - BUBBLE_TAIL * scale - height
    const below = cardBottom + BUBBLE_GAP * scale + BUBBLE_TAIL * scale
    const flip = above < 0

    this.bubble.draw(
      left,
      flip ? below : above,
      { x: card.portrait.x, y: card.hit.y },
      flip ? 'top' : 'bottom',
      scale,
    )
  }

  /** Skipped entirely when everything fits: a scrollbar that cannot move is furniture. */
  private drawScrollbar(): void {
    this.scrollbar.clear()
    if (this.maxScroll <= 0) return

    const { x, width, height } = this.scrollbarTrack
    const radius = width / 2
    // Region-camera space: content starts at y 0 and the camera is scrolled to `scrollY`, so adding
    // it back is what pins the bar to the viewport.
    const y = this.scrollY

    this.scrollbar.fillStyle(CARD_STROKE, SCROLLBAR_TRACK_ALPHA)
    this.scrollbar.fillRoundedRect(x, y, width, height, radius)

    const visible = height / (height + this.maxScroll)
    const thumb = Math.max(SCROLLBAR_MIN_THUMB, height * visible)
    const at = y + (height - thumb) * (this.scrollY / this.maxScroll)

    this.scrollbar.fillStyle(CARD_STROKE, SCROLLBAR_THUMB_ALPHA)
    this.scrollbar.fillRoundedRect(x, at, width, thumb, radius)
  }

  layout(width: number, height: number): void {
    const scale = uiScale(width)
    const panelW = Math.min(PANEL_MAX_WIDTH * scale, width - VIEWPORT_MARGIN * 2)
    const panelH = height - VIEWPORT_MARGIN * 2
    const pad = PANEL_PAD * scale

    this.overlay.layout(width, height)
    this.overlay.drawPanel(panelW, panelH, scale, ACCENT)

    // Panel-local coordinates: the container is centred on the viewport, so its own origin is the
    // middle of the plate.
    let y = -panelH / 2 + pad
    this.title.setFontSize(TITLE_FONT_SIZE * scale).setPosition(0, y + this.title.height / 2)
    y += this.title.height + 4 * scale
    this.subtitle.setFontSize(SUBTITLE_FONT_SIZE * scale).setPosition(0, y + this.subtitle.height / 2)
    y += this.subtitle.height + 6 * scale
    this.note.setFontSize(SUBTITLE_FONT_SIZE * scale).setWordWrapWidth(panelW - pad * 2)
    this.note.setPosition(0, y)
    y += this.note.height + 10 * scale

    // The two exits are pinned to the bottom of the plate, so the gap under them is the padding
    // whatever the list did.
    const bottom = panelH / 2 - pad
    this.closeButton.layout(0, bottom - this.closeButton.height / 2, scale)
    this.startButton.layout(0, bottom - this.closeButton.height - 8 * scale - this.startButton.height / 2, scale)

    // The list's rectangle, in SCREEN coordinates — a camera viewport is not a display object and
    // knows nothing about the panel container's transform.
    const listX = width / 2 - panelW / 2 + pad
    const listW = panelW - pad * 2
    const listTop = height / 2 + y
    const listBottom = height / 2 + bottom - this.closeButton.height - this.startButton.height - 16 * scale
    const listH = listHeightBetween(listTop, listBottom)
    this.region.setBounds({ x: listX, y: listTop, width: listW, height: listH })

    const barWidth = SCROLLBAR_WIDTH * scale
    const column = listW - (barWidth + SCROLLBAR_GAP * 2 * scale)
    this.layoutCards(column, scale)
    // Wrapped to the column rather than to the bubble, which is sized FROM the text — the two would
    // otherwise define each other.
    this.bubble.setMetrics(BUBBLE_FONT_SIZE * scale, column - BUBBLE_PAD * 4 * scale)
    this.drawBubble()

    this.scrollbarTrack = { x: column + SCROLLBAR_GAP * 2 * scale, width: barWidth, height: listH }
    this.maxScroll = Math.max(0, this.contentHeight - listH)
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScroll)
    this.region.camera.setScroll(0, this.scrollY)
    this.drawScrollbar()

    // Mutual ignore lists. An object in NEITHER renders in BOTH — here that would draw the whole
    // cast a second time, unscrolled, over the panel.
    // The bubble belongs to the LIST's camera, like the cards and the scrollbar — it is drawn in list
    // coordinates and has to scroll with the card that is speaking.
    const listObjects = [
      ...this.cards.flatMap((c) => [c.plate, c.portrait, c.title, c.about, c.status, c.check, c.hit]),
      ...this.bubble.objects,
    ]
    this.region.camera.ignore([this.overlay.scrim, this.overlay.panel])
    this.cameras.main.ignore([...listObjects, this.scrollbar])
  }

  /** Cards are laid out at their TRUE, unscrolled positions inside the region and the camera pans
   * over them — positioning content once is the whole point of a camera-viewport clip. */
  private layoutCards(column: number, scale: number): void {
    const pad = CARD_PADDING * scale
    const portraitH = PORTRAIT_HEIGHT * scale
    const portraitW = portraitWidthFor(portraitH)
    let y = 0

    for (const card of this.cards) {
      const selected = card.id === this.chosen
      const index = opponentIndex(card.id)
      // What unlocks it, named — "beat the sergeant" is a thing a player can go and do, where a
      // padlock alone is a thing that happened to them.
      card.status.setText(card.unlocked ? '' : t('opponentLocked', { name: t(OPPONENTS[Math.max(0, index - 1)].nameKey) }))

      const textLeft = pad + portraitW + 12 * scale
      // The right-hand reserve is the tick's, and it is 16 rather than 22 for the same reason the
      // portrait grew: the tick is a 20px glyph, so six of those pixels were slack the text could
      // have been using.
      const textWidth = column - textLeft - pad - 16 * scale
      card.title.setFontSize(CARD_TITLE_FONT_SIZE * scale).setPosition(textLeft, y + pad)
      card.about.setFontSize(CARD_ABOUT_FONT_SIZE * scale).setWordWrapWidth(textWidth)
      card.about.setPosition(textLeft, y + pad + card.title.height + 3 * scale)
      card.status.setFontSize(CARD_ABOUT_FONT_SIZE * scale).setWordWrapWidth(textWidth)
      card.status.setPosition(textLeft, card.about.y + card.about.height + 4 * scale)
      card.status.setVisible(!card.unlocked)

      const contentH = (card.unlocked ? card.about.y + card.about.height : card.status.y + card.status.height) + pad - y
      const cardH = Math.max(CARD_MIN_HEIGHT * scale, portraitH + pad * 2, contentH)

      card.plate.clear()
      card.plate.fillStyle(selected ? CARD_FILL_SELECTED : CARD_FILL, 1)
      card.plate.fillRoundedRect(0, y, column, cardH, CARD_RADIUS * scale)
      card.plate.lineStyle((selected ? 3 : 2) * scale, selected ? CARD_STROKE_SELECTED : CARD_STROKE, 1)
      card.plate.strokeRoundedRect(0, y, column, cardH, CARD_RADIUS * scale)

      /**
       * **A slot under the portrait, and it became necessary when the portraits grew.**
       *
       * Every frame is rendered ON the card's own plum rather than cut out to alpha (see
       * `gen_chapaev_bots.py`'s first decision, and `ui/portrait.ts`), which is invisible while the
       * two tones match — and they stop matching the moment a card is SELECTED, because a selected
       * card is a lighter plum. At 84px the mismatch was a thumbnail's worth of edge; at 112 it is a
       * rectangle of the wrong colour sitting on the card. Painting the slot in the frame's own tone
       * makes it a framed picture instead: deliberate at every size, and identical whether the card
       * is selected or not.
       */
      card.plate.fillStyle(PORTRAIT_SLOT_FILL, 1)
      card.plate.fillRoundedRect(pad, y + pad, portraitW, portraitH, PORTRAIT_SLOT_RADIUS * scale)

      const dim = card.unlocked ? 1 : LOCKED_ALPHA
      card.portrait.setAlpha(dim)
      card.title.setAlpha(dim)
      card.about.setAlpha(dim)
      placePortrait(card.portrait, pad + portraitW / 2, y + cardH - pad, portraitH)

      card.check.setFontSize(20 * scale).setPosition(column - pad, y + cardH / 2)
      card.check.setVisible(selected)

      card.hit.setPosition(column / 2, y + cardH / 2)
      card.hit.setSize(column, cardH)
      ;(card.hit.input?.hitArea as Phaser.Geom.Rectangle | undefined)?.setTo(0, 0, column, cardH)

      y += cardH + CARD_GAP * scale
    }

    this.contentHeight = Math.max(0, y - CARD_GAP * scale)
  }

  /**
   * Closes and hands control back.
   *
   * The callback runs AFTER the opener has been resumed, so whatever it does — starting a match,
   * going back to the mode list — happens to a scene that is actually running. Same contract, and
   * the same deferred resume under a platform pause, as `MatchResult.close()`.
   */
  /** Backing out. One method rather than the callback written twice, so the scrim and the Close
   * button cannot come to mean different things. */
  private cancel(): void {
    this.close(this.request.onCancel ?? (() => {}))
  }

  private close(then: () => void): void {
    this.overlay.close(() => {
      this.scene.stop()

      const resume = (): void => {
        this.scene.resume(this.request.opener)
        then()
      }

      if (isPlatformPaused()) {
        this.game.events.once(YTEvents.RESUME, resume)
        return
      }
      resume()
    })
  }
}

function ruleNameKey(id: RulesId): StringKey {
  switch (id) {
    case 'bumper':
      return 'ruleNameBumper'
    case 'blitz':
      return 'ruleNameBlitz'
    case 'pits':
      return 'ruleNamePits'
    default:
      return 'ruleNameClassic'
  }
}
