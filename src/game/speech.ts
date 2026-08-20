/**
 * **When an opponent speaks, and which of its lines it uses.**
 *
 * Pure policy — no Phaser, no scene, no timers — so `scripts/verify-content.mjs` can exercise the
 * rate limit and the rotation in plain Node. `scenes/Game.ts` supplies the events and
 * `ui/speechLine.ts` draws whatever comes back.
 *
 * Two rules, both about the same failure: a character that talks on every shot stops being a
 * character and becomes a stream of text over the board.
 *
 * - **At most one line per three shots**, counted in SHOTS rather than seconds, so the limit holds
 *   identically through the bot's fifth-of-a-second search and through a player who thinks for a
 *   minute before pulling the slingshot. Three rather than the five a grid game wants, because a
 *   Chapaev round is about ten shots end to end (`verify:bot` measures it): at five, a character
 *   would get two lines in a round and half of them would be the hello.
 * - **The loud moments get a SHORTER cooldown, not an exemption.** A disc leaving the board used to
 *   bypass the limit outright, and in a round where discs leave on most shots that is a character
 *   commenting on every single one — which is the stream-of-text failure the limit exists to
 *   prevent, arriving through the door left open for it. {@link LOUD_COOLDOWN_SHOTS} lets a
 *   knockout interrupt a quiet stretch without letting a run of them turn into a monologue.
 *
 * **What is NOT rate-limited is the face.** `ui/portrait.ts`'s reaction fires on every one of these
 * moments whether a line comes back or not, which is the whole reason the limit can afford to be
 * this tight: the character still visibly flinches when its disc goes over, it simply does not
 * always have something to say about it. Silence with a reaction reads as a person; silence with a
 * blank face reads as a bug.
 */

import type { Opponent, SpeechTrigger } from './opponents'

/**
 * The moments that carry the shorter cooldown: a disc left the board, whoever's it was.
 *
 * `onMatchStart`, `onWin` and `onLose` are deliberately NOT here even though they always fire in
 * practice — they happen when the counter has been reset anyway, so listing them would be stating a
 * consequence as a rule.
 */
export const LOUD_TRIGGERS: readonly SpeechTrigger[] = [
  'onOwnKnockout',
  'onOwnCombo',
  'onOwnBlunder',
  'onPlayerKnockout',
  'onPlayerBlunder',
]

/** Shots that must pass between two ordinary lines. */
export const SPEECH_COOLDOWN_SHOTS = 3

/**
 * …and between two loud ones. **Two, not zero.**
 *
 * Zero is what this was, spelled as an exemption, and it made a character speak on literally every
 * knockout — in a branch where discs come off in twos that is a line every shot. Two lets a
 * knockout cut into a quiet stretch (which is the beat that would otherwise be missed) while a run
 * of them still comes out as a remark, a pause, a remark.
 */
export const LOUD_COOLDOWN_SHOTS = 2

function cooldownFor(trigger: SpeechTrigger): number {
  return LOUD_TRIGGERS.includes(trigger) ? LOUD_COOLDOWN_SHOTS : SPEECH_COOLDOWN_SHOTS
}

export interface SpeechDirector {
  /** Count one resolved shot, whoever fired it. */
  noteShot(): void
  /** The line to speak now, or `null` when the rate limit swallows it. */
  next(trigger: SpeechTrigger): string | null
  /** Back to a fresh round — a scene instance is reused across `scene.start()`. */
  reset(): void
}

/**
 * A director for one character.
 *
 * Lines ROTATE rather than being drawn at random, for the same reason the audio cues rotate their
 * variants: with three alternatives a uniform pick repeats about a third of the time, and a repeat
 * is the one artefact having alternatives exists to prevent. The rotation is per trigger, so hearing
 * all three "I missed" lines does not use up the "I took one" ones.
 */
export function speechDirector(character: Opponent): SpeechDirector {
  const cursor = new Map<SpeechTrigger, number>()
  let shotsSinceLine = SPEECH_COOLDOWN_SHOTS

  return {
    noteShot() {
      shotsSinceLine++
    },

    next(trigger: SpeechTrigger): string | null {
      const lines = character.lines[trigger]
      if (!lines || lines.length === 0) return null
      if (shotsSinceLine < cooldownFor(trigger)) return null

      const index = (cursor.get(trigger) ?? -1) + 1
      cursor.set(trigger, index)
      shotsSinceLine = 0
      return lines[index % lines.length]
    },

    reset() {
      cursor.clear()
      shotsSinceLine = SPEECH_COOLDOWN_SHOTS
    },
  }
}
