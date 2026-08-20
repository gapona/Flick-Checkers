import { ATLAS_FRAMES } from '../assets'
import * as Phaser from 'phaser'
import { getDisplayFontStack } from './font'
import { buttonWidth, gameButton, type GameButton } from './button'
import { MIN_TOUCH_TARGET } from './uiScale'

/**
 * A volume fader: mute button, track, handle, and the value as a number.
 *
 * ## Why a fader and not a switch
 *
 * On/off is the wrong control for sound in a game played on a phone in a room with other people.
 * The player's real question is "quieter", and a switch answers it with "off" — so the music gets
 * turned off entirely and never comes back on.
 *
 * ## The handle is smaller than the finger pressing it
 *
 * A 32px knob is under `MIN_TOUCH_TARGET`, and unlike a button it cannot simply be drawn bigger
 * without becoming a lozenge. Its hit area is therefore inflated to 44 independently of its size —
 * the one place in the UI where the visible control and its target deliberately disagree.
 *
 * **And the track takes taps too.** Dragging a small knob is the fiddly way to set a value; tapping
 * where you want it is the fast one, and a slider that only drags feels broken to anyone who tries
 * the other thing first.
 */

/**
 * A floor on the track, and the reason the width is now a PARAMETER rather than a constant.
 *
 * The track used to be a fixed 240 design units, and a fixed-width control inside a fixed-width panel
 * is two numbers that have to agree with each other by hand. They did not: with a 64px mute button,
 * a 14px gap and 20px of panel padding either side, the row wanted 374 units inside a 340-unit panel
 * — so the knob at 100% sat 14px OUTSIDE the panel's right border, on top of it, with the `100%`
 * readout underneath it. Reported as the settings panel spilling off screen, which is what it looked
 * like.
 *
 * So the caller passes the width it actually has and the track takes what is left of it. This floor
 * only stops a very narrow row collapsing the track to nothing.
 */
const MIN_TRACK_WIDTH = 120
const TRACK_HEIGHT = 12
const HANDLE_SIZE = 32
/** Gap between the mute button and the track. */
const MUTE_GAP = 14
/**
 * How far above the track's centre the label/readout line sits.
 *
 * 26 rather than 22, and the extra 4 is load-bearing: the readout is right-aligned to the track's
 * END, which is exactly where the knob stands at 100%, so the two share a column and can only be
 * separated vertically. At 22 the readout's descender reached 8 units past the knob's top edge and
 * the number sat inside the knob — visible in the shipped screenshot.
 */
const CAPTION_RISE = 26
/** Coarse on purpose. A continuous fader invites fine-tuning a value nobody can hear the
 * difference in, and 5% steps make the readout a round number every time. */
const STEP = 0.05

const TRACK_BASE = 0x2a0f40
const TRACK_CONTOUR = 0x1a0628
const TRACK_FILL = 0xf5b52e
const HANDLE_FACE = 0xffd873
const HANDLE_SIDE = 0x8a4a08
const HANDLE_CONTOUR = 0x2b1405
const LABEL_COLOR = '#e6d8f5'
const VALUE_COLOR = '#ffcf3f'
const LABEL_FONT_SIZE = 18
const VALUE_FONT_SIZE = 16

/** Which drawn frame the mute button wears. Three levels, not two: a speaker with no waves reads as
 * "muted", one wave as "quiet", two as "loud" — and a control that looks identical at 10% and 90%
 * is a control that says nothing. */
function muteFrame(level: number): string {
  if (level <= 0) return ATLAS_FRAMES.soundOff
  return level < 0.5 ? ATLAS_FRAMES.soundLow : ATLAS_FRAMES.soundOn
}

export interface SliderOptions {
  label: string
  /** `0..1`. */
  value: number
  onChange: (value: number) => void
  /** Fired once, on release — for a preview cue that would machine-gun if it fired per pixel. */
  onCommit?: (value: number) => void
  /**
   * What the mute button restores, asked at the moment it is pressed.
   *
   * A callback rather than a value the slider remembers for itself: the level has to survive a
   * reload, and a control's local variable does not. The owner reads it from the save.
   */
  restore: () => number
}

export interface Slider {
  readonly objects: Phaser.GameObjects.GameObject[]
  readonly value: number
  setValue(value: number): void
  /**
   * `x` is the LEFT edge of the row, `y` its vertical centre — sliders line up on their labels, so
   * the caller positions a left edge rather than a centre.
   *
   * `rowWidth` is the total width the row may occupy, mute button and knob overhang included: after
   * this call nothing the slider draws lies outside `x .. x + rowWidth`. That is the contract the
   * caller needs, because the caller is the only one that knows how much room there is — see
   * {@link MIN_TRACK_WIDTH}.
   */
  layout(x: number, y: number, scale: number, rowWidth: number): void
  destroy(): void
}

export function createSlider(scene: Phaser.Scene, options: SliderOptions): Slider {
  let value = clampStep(options.value)
  let scale = 1
  let trackLeft = 0
  let trackWidth = MIN_TRACK_WIDTH
  let centreY = 0

  const objects: Phaser.GameObjects.GameObject[] = []

  const label = scene.add.text(0, 0, options.label, { fontFamily: getDisplayFontStack(), fontSize: LABEL_FONT_SIZE, color: LABEL_COLOR }).setOrigin(0, 0.5)
  const readout = scene.add.text(0, 0, '', { fontFamily: getDisplayFontStack(), fontSize: VALUE_FONT_SIZE, color: VALUE_COLOR }).setOrigin(1, 0.5)
  const track = scene.add.graphics()
  const handle = scene.add.graphics()

  // The whole track is a tap target, and it is a Rectangle rather than the Graphics for the same
  // reason every other control here is: Graphics has no sensible hit area of its own.
  const trackHit = scene.add.rectangle(0, 0, MIN_TRACK_WIDTH, MIN_TOUCH_TARGET, 0x000000, 0).setInteractive({ useHandCursor: true })
  const handleHit = scene.add.rectangle(0, 0, MIN_TOUCH_TARGET, MIN_TOUCH_TARGET, 0x000000, 0).setInteractive({ useHandCursor: true })

  const mute = gameButton(scene, { size: 'icon', variant: 'plum', iconFrame: muteFrame(value) })
  objects.push(label, track, handle, trackHit, handleHit, readout, mute.container)

  function clampStep(raw: number): number {
    const clamped = Math.max(0, Math.min(1, raw))
    return Math.round(clamped / STEP) * STEP
  }

  function apply(next: number, commit: boolean): void {
    const stepped = clampStep(next)
    if (stepped !== value) {
      value = stepped
      options.onChange(value)
      redraw()
    }
    if (commit) options.onCommit?.(value)
  }

  /**
   * Where a pointer sits along the track, `0..1`.
   *
   * **Via the track's WORLD transform, not its local `x`.** The first version compared
   * `pointer.x` — which is in screen space — against `trackLeft`, which is in whatever space the
   * slider's parent happens to be. Inside `Settings`' panel container that parent is offset to the
   * middle of the screen, so every tap computed a value about 1.5 and clamped to 100%: the track
   * looked interactive and silently refused to move. A control that ends up inside a container is
   * the normal case, so the conversion belongs here rather than in a rule the caller must remember.
   */
  function valueAt(pointerX: number): number {
    const matrix = trackHit.getWorldTransformMatrix()
    const worldWidth = trackWidth * matrix.scaleX
    if (worldWidth <= 0) return 0
    // `trackHit` is centred on the track, so its world x is the track's middle.
    const worldLeft = matrix.tx - worldWidth / 2
    return (pointerX - worldLeft) / worldWidth
  }

  function redraw(): void {
    const h = TRACK_HEIGHT * scale
    const radius = h / 2
    const filled = trackWidth * value

    track.clear()
    track.fillStyle(TRACK_BASE, 1)
    track.fillRoundedRect(trackLeft, centreY - h / 2, trackWidth, h, radius)
    if (filled > 1) {
      track.fillStyle(TRACK_FILL, 1)
      track.fillRoundedRect(trackLeft, centreY - h / 2, Math.max(filled, h), h, radius)
    }
    track.lineStyle(2 * scale, TRACK_CONTOUR, 1)
    track.strokeRoundedRect(trackLeft, centreY - h / 2, trackWidth, h, radius)

    // The knob is built like a button — face, side, contour — so it belongs to the same set of
    // objects as everything else the player presses.
    const knobX = trackLeft + filled
    const r = (HANDLE_SIZE * scale) / 2
    handle.clear()
    handle.fillStyle(HANDLE_SIDE, 1)
    handle.fillCircle(knobX, centreY + 3 * scale, r)
    handle.fillStyle(HANDLE_FACE, 1)
    handle.fillCircle(knobX, centreY, r)
    handle.lineStyle(3 * scale, HANDLE_CONTOUR, 1)
    handle.strokeCircle(knobX, centreY, r)

    handleHit.setPosition(knobX, centreY)
    readout.setText(`${Math.round(value * 100)}%`)
    mute.setIconFrame(muteFrame(value))
  }

  trackHit.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
    apply(valueAt(pointer.x), true)
  })

  // Dragging is tracked on the SCENE's pointer, not the handle's own move events: once a drag is
  // under way the finger routinely leaves the 44px target, and a handle that only listens to itself
  // stops following at exactly the moment it matters.
  let dragging = false
  handleHit.on(Phaser.Input.Events.POINTER_DOWN, () => {
    dragging = true
  })
  const onMove = (pointer: Phaser.Input.Pointer): void => {
    if (dragging) apply(valueAt(pointer.x), false)
  }
  const onUp = (): void => {
    if (!dragging) return
    dragging = false
    options.onCommit?.(value)
  }
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, onMove)
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, onMove)
    scene.input.off(Phaser.Input.Events.POINTER_UP, onUp)
  })

  mute.hitArea.on(Phaser.Input.Events.POINTER_UP, () => {
    // The level to come back to is NOT captured here — the owner persists it when the slider is
    // moved, so this works across a reload as well as within one session.
    apply(value > 0 ? 0 : options.restore(), true)
  })

  return {
    objects,
    get value() {
      return value
    },
    setValue(next: number) {
      value = clampStep(next)
      redraw()
    },
    layout(x: number, y: number, nextScale: number, rowWidth: number) {
      scale = nextScale
      centreY = y

      // Asked of the token rather than read off the button, which would still be at the previous
      // scale at this point — see `buttonWidth`'s own note.
      const muteWidth = buttonWidth('icon', scale)
      const gap = MUTE_GAP * scale
      // The knob is CENTRED on the end of the track, so half of it hangs past it. Reserving that
      // radius is what keeps the control inside the width the caller promised.
      const knobRadius = (HANDLE_SIZE * scale) / 2

      mute.layout(x + muteWidth / 2, y, scale)

      trackLeft = x + muteWidth + gap
      trackWidth = Math.max(MIN_TRACK_WIDTH * scale, rowWidth - muteWidth - gap - knobRadius)

      label.setFontSize(LABEL_FONT_SIZE * scale)
      label.setPosition(trackLeft, y - CAPTION_RISE * scale)

      trackHit.setPosition(trackLeft + trackWidth / 2, y)
      trackHit.setSize(trackWidth, MIN_TOUCH_TARGET)
      ;(trackHit.input?.hitArea as Phaser.Geom.Rectangle | undefined)?.setTo(0, 0, trackWidth, MIN_TOUCH_TARGET)

      readout.setFontSize(VALUE_FONT_SIZE * scale)
      readout.setPosition(trackLeft + trackWidth, y - CAPTION_RISE * scale)

      redraw()
    },
    destroy() {
      for (const object of objects) object.destroy()
      mute.destroy()
    },
  }
}
