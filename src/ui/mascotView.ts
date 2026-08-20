import * as Phaser from 'phaser'
import { MASCOT_BLINK_KEY, MASCOT_KEY } from '../assets'

/**
 * **The mascot, alive.**
 *
 * It was one static `Image` on the menu. A still character on an otherwise moving screen (the discs
 * drift, the title pulses) reads as a sticker somebody left there — and this one is a face, which is
 * the thing a player's eye goes to first and forgives least.
 *
 * Three motions, and they are deliberately the three the draughts project's own mascot has, because
 * they are the ones that do the work:
 *
 * - **A bob.** Slow, and measured as a FRACTION of the drawn height rather than in pixels, so the
 *   character breathes by the same proportion at every size instead of by the same three pixels.
 * - **A blink.** Two textures, swapped — see {@link MASCOT_BLINK_KEY} for why the closed-eye frame
 *   is derived from the open one by arithmetic instead of being rendered a second time. The blink is
 *   the single cheapest thing that turns a drawing of a face into a face.
 * - **A press reaction.** A squash into a slightly-too-large pop. This one is the player's, not the
 *   idle's, so it is the one motion that IS a tween.
 *
 * ## The idle is driven from the scene clock, never from tweens
 *
 * `Phaser.Time.Clock` advances with the scene and stops when the scene is paused; the TweenManager
 * does not, so a tweened idle keeps breathing underneath a paused game and an open Settings panel.
 * That is also why {@link MascotView.react} is allowed to be a tween: it is a 260ms one-shot the
 * player triggered, and it cannot outlive the press that started it.
 *
 * ## A tilt as well as a bob, which the draughts mascot does not have
 *
 * A pure vertical bob on a round object reads as a bouncing ball. This character is a coin balancing
 * a top hat, so a slow tilt on a different period from the bob — the two never in phase, so the
 * motion never repeats visibly — is what makes it a thing keeping its balance rather than a thing
 * being moved up and down.
 */

/** The bob and the tilt. Deliberately co-prime-ish periods: at 1500/2300 the pair takes about 34
 * seconds to repeat, which is longer than anyone looks at a menu. */
const BOB_PERIOD_MS = 1500
const TILT_PERIOD_MS = 2300
/** As a fraction of the drawn height, so the motion scales with the character. */
const BOB_FRACTION = 0.022
const TILT_DEGREES = 1.6

/** A blink every few seconds, held for about two frames at 60fps. Longer reads as a wince. */
const BLINK_EVERY_MS = 3400
const BLINK_MS = 120
/** …and occasionally a second one straight after the first, because a real blink often comes in
 * pairs and a metronome does not. Deterministic (every fourth), not random: the point is that the
 * rhythm is not exactly one beat, and a coin flip on every blink would be a thing to keep a seed
 * for. */
const DOUBLE_BLINK_EVERY = 4
const DOUBLE_BLINK_GAP_MS = 160

/** The press reaction: a quick squash, then a pop slightly past full size, then back. */
const REACT_MS = 260
const REACT_SQUASH = 0.92
const REACT_POP = 1.08

export interface MascotView {
  /** The sprite. Position it from the owning scene's `layout()` through {@link setRest}, and hand it
   * to a camera set where a scene has one. */
  readonly image: Phaser.GameObjects.Image
  /** Sets the drawn height, preserving the delivery's aspect. */
  setHeight(height: number): void
  /** Where the character rests: the bob and the tilt are offsets from this. Origin is `(0, 1)`, so
   * this is its bottom-LEFT corner — the anchor the menu already positioned it by. */
  setRest(x: number, y: number): void
  /** Current drawn size, for a caller laying out around it. */
  readonly width: number
  readonly height: number
  /** One-shot acknowledgement of a poke. Safe to call repeatedly — a second call restarts it rather
   * than stacking a second tween on the same scale. */
  react(): void
  destroy(): void
}

export function createMascotView(scene: Phaser.Scene, depth = -800): MascotView {
  const image = scene.add.image(0, 0, MASCOT_KEY).setOrigin(0, 1).setDepth(depth)
  const aspect = image.width / image.height

  let restX = 0
  let restY = 0
  let drawnHeight = image.height
  let react: Phaser.Tweens.Tween | undefined
  /** Scale multiplier owned by the react tween. Kept separate from the display size so the two
   * cannot fight: `setHeight` writes the size, this scales whatever that produced. */
  const pop = { value: 1 }
  let blinks = 0
  let lastBlinkWindow = -1

  const apply = (time: number): void => {
    if (!image.visible) return

    const bob = Math.sin((time / BOB_PERIOD_MS) * Math.PI * 2) * drawnHeight * BOB_FRACTION
    image.setDisplaySize(drawnHeight * aspect * pop.value, drawnHeight * pop.value)
    // The tilt pivots about the FEET, which is where the origin already is, so a character standing
    // on the menu's floor rocks on the spot rather than swinging from its top-left corner.
    image.setAngle(Math.sin((time / TILT_PERIOD_MS) * Math.PI * 2) * TILT_DEGREES)
    image.setPosition(restX, restY + bob)

    // The blink window, counted rather than timed against a stored deadline: a scene that was
    // paused for a minute should come back to the same rhythm rather than to a burst of catch-up.
    const window = Math.floor(time / BLINK_EVERY_MS)
    if (window !== lastBlinkWindow) {
      lastBlinkWindow = window
      blinks++
    }
    const into = time % BLINK_EVERY_MS
    const shut =
      into < BLINK_MS ||
      (blinks % DOUBLE_BLINK_EVERY === 0 && into >= BLINK_MS + DOUBLE_BLINK_GAP_MS && into < BLINK_MS * 2 + DOUBLE_BLINK_GAP_MS)
    const wanted = shut ? MASCOT_BLINK_KEY : MASCOT_KEY
    // Guarded: `setTexture` on the texture it already has still re-resolves the frame and dirties
    // the object, every frame, for nothing.
    if (image.texture.key !== wanted) image.setTexture(wanted)
  }

  const onUpdate = (time: number): void => apply(time)
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate)

  const stop = (): void => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate)
    react?.remove()
    react = undefined
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, stop)
  scene.events.once(Phaser.Scenes.Events.DESTROY, stop)

  return {
    image,
    get width() {
      return drawnHeight * aspect
    },
    get height() {
      return drawnHeight
    },
    setHeight(height: number) {
      drawnHeight = height
      image.setDisplaySize(height * aspect * pop.value, height * pop.value)
    },
    setRest(x: number, y: number) {
      restX = x
      restY = y
      image.setPosition(x, y)
    },
    react() {
      // Removed rather than left to overlap: two tweens on one value fight, and the loser leaves
      // the sprite at whatever size it happened to be mid-flight.
      react?.remove()
      pop.value = 1
      react = scene.tweens.add({
        targets: pop,
        value: { from: REACT_SQUASH, to: REACT_POP },
        duration: REACT_MS * 0.55,
        yoyo: true,
        ease: 'Sine.easeOut',
        onComplete: () => {
          pop.value = 1
          react = undefined
        },
      })
    },
    destroy() {
      stop()
      image.destroy()
    },
  }
}
