import type * as Phaser from 'phaser'

/**
 * **An opponent's line, typed into a `Text` the caller owns and positions.**
 *
 * Not a speech bubble, and that is a decision rather than an economy. A bubble is a second window
 * floating over the board — and this board is the whole playfield, every pixel of which is a drag
 * surface for aiming (`board/boardView.ts`'s single interactive zone). A plate that rises out of a
 * portrait and covers part of it for three seconds would sit on top of the one surface the player is
 * about to gesture across. The line belongs in the HUD band beside the face, the way a caption
 * belongs under a picture rather than in a balloon over it.
 *
 * What matters and is easy to lose: **the line types in one character at a time**, {@link
 * SpeechLine.onGlyph} fires per revealed character, and `audio/dialogueVoice.ts` quantises the voice
 * to that. "The mouth moves while the words appear" is the whole of the illusion, and it is timing, not
 * decoration.
 */

/**
 * How long a line stays up **after the last character lands**, not from the first.
 *
 * Measured from the end so every line gets the same beat to be read whatever its length, and so the
 * reveal rate stays a free knob: measured from `say()`, a slower reveal would eat the reading time,
 * and at a slow enough one a long line would start disappearing before it finished typing.
 */
export const SPEECH_HOLD_MS = 2600
/** Per-character reveal. The voice is quantised to this — see `audio/dialogueVoice.ts`. */
export const SPEECH_TYPE_MS = 42

export interface SpeechLine {
  /** Shows a line, replacing whatever is up. */
  say(text: string): void
  hide(): void
  /**
   * Cancels the reveal and forgets the line **without touching the `Text`** — for a scene being torn
   * down.
   *
   * **`hide()` cannot be used there, and this is not a style preference.** Phaser's `DisplayList`
   * registers its own `SHUTDOWN` listener when the scene boots, i.e. *before* anything `create()`
   * registers, and that listener destroys every game object in the scene. So by the time a scene's
   * own shutdown handler runs, its `Text` objects are already destroyed — and `setText()` on one
   * throws from inside the shutdown handler, which takes the whole game down with it: every scene
   * stops and the loop dies while the music keeps playing, because that lives on the sound manager.
   */
  stop(): void
  /**
   * Fires for every revealed character — `audio/dialogueVoice.ts` listens here.
   *
   * **It passes the CHARACTER, not just the count.** The voice aligns its syllables to vowels, which
   * is where a mouth opens, and an index alone cannot say whether the letter that just appeared is
   * one. `end` marks the character that closes the sentence, so a rising or falling contour has
   * something to arrive on.
   */
  onGlyph: ((revealed: number, total: number, char: string, end: boolean) => void) | null
  onDone: (() => void) | null
  /**
   * Fires when a line goes away — its hold expired, or it was replaced or cleared.
   *
   * **`onDone` is not this**: that one fires when the last character *lands*, which is the middle of
   * a line's life, and a caller that needs to know the line is gone (to put the character's name back
   * on the row it borrowed) would otherwise have to poll for it.
   */
  onEnd: (() => void) | null
  readonly visible: boolean
  /** The full line currently being shown, or `''`. Callers measure their own layout against this
   * rather than against the `Text`, whose contents are mid-reveal most of the time. */
  readonly line: string
}

/**
 * Drives `text`. The caller owns the object: its font, its colour, its wrap width and where it sits.
 * This owns only *when* characters appear and when the line goes away.
 *
 * **A queue of exactly one.** A new line replaces whatever is up rather than waiting behind it — a
 * backlog of quips would still be arriving three shots after the moment they described.
 */
export function speechLine(scene: Phaser.Scene, text: Phaser.GameObjects.Text): SpeechLine {
  let line = ''
  let typeTimer: Phaser.Time.TimerEvent | null = null
  let lifeTimer: Phaser.Time.TimerEvent | null = null

  const clearTimers = () => {
    typeTimer?.remove()
    lifeTimer?.remove()
    typeTimer = null
    lifeTimer = null
  }

  const hide = () => {
    clearTimers()
    const had = line !== ''
    line = ''
    text.setText('').setVisible(false)
    if (had) speech.onEnd?.()
  }

  /** Everything `hide()` does except the two calls that reach into the `Text`, and without `onEnd` —
   * a teardown is not a line ending, and the caller listening for that is going away too. See
   * {@link SpeechLine.stop}. */
  const stop = () => {
    clearTimers()
    line = ''
  }

  const speech: SpeechLine = {
    onGlyph: null,
    onDone: null,
    onEnd: null,

    get visible() {
      return line !== ''
    },
    get line() {
      return line
    },

    say(next: string) {
      if (!next) return
      // Not through `hide()`: replacing one line with another is not the line *ending*, and a caller
      // that puts the name back on `onEnd` would flicker it for a frame between quips.
      clearTimers()
      line = next
      text.setVisible(true)
      // Emptied and typed back in. The caller has already reserved this line's row, so nothing
      // reflows — but the text is still set empty first, so a line never appears whole for one frame
      // before the reveal starts.
      text.setText('')

      let revealed = 0
      typeTimer = scene.time.addEvent({
        delay: SPEECH_TYPE_MS,
        repeat: line.length - 1,
        callback: () => {
          revealed++
          text.setText(line.slice(0, revealed))
          speech.onGlyph?.(revealed, line.length, line[revealed - 1] ?? '', revealed >= line.length)
          if (revealed >= line.length) speech.onDone?.()
        },
      })

      lifeTimer = scene.time.delayedCall(line.length * SPEECH_TYPE_MS + SPEECH_HOLD_MS, hide)
    },

    hide,
    stop,
  }

  return speech
}
