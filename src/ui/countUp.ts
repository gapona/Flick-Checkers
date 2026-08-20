import * as Phaser from 'phaser'

/**
 * A number that arrives by rising to itself.
 *
 * `PROMPT-UI-CHAPAEV.md`'s chunk 10 calls this "the cheapest trick that turns a result into an
 * event", and cheap is exactly right: the panel is otherwise a static list of facts, and a fact that
 * is simply *there* when the panel opens was never noticed arriving. Four hundred milliseconds is
 * long enough for the eye to catch the movement and short enough that nobody waits for it.
 *
 * Two things it deliberately does NOT do:
 *
 * - **It never animates a zero.** Counting `0 → 0` is 400ms of a number vibrating in place, which
 *   reads as a bug. Nothing to count means the value is set and `onComplete` fires on the spot.
 * - **It never leaves a fraction on screen.** The tween runs on a float and every frame is rounded
 *   before it is formatted, so the last frame is the real value rather than `1799.6`.
 */

export const COUNT_UP_MS = 400

export interface CountUpOptions {
  /** Turns the current step into the string to show. Defaults to the plain integer. */
  format?: (value: number) => string
  duration?: number
  /** Runs once the number has settled — this is where a badge earned BY that number appears, so it
   * lands after its own justification rather than beside it. */
  onComplete?: () => void
}

export function countUp(scene: Phaser.Scene, label: Phaser.GameObjects.Text, to: number, options: CountUpOptions = {}): void {
  const format = options.format ?? ((value: number) => String(value))

  if (to === 0) {
    label.setText(format(0))
    options.onComplete?.()
    return
  }

  const step = { value: 0 }
  label.setText(format(0))
  scene.tweens.add({
    targets: step,
    value: to,
    duration: options.duration ?? COUNT_UP_MS,
    ease: 'Cubic.easeOut',
    onUpdate: () => label.setText(format(Math.round(step.value))),
    onComplete: () => {
      label.setText(format(to))
      options.onComplete?.()
    },
  })
}
