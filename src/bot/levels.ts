/**
 * The three numbers that make one opponent play differently from another, and a fixed reference
 * triple for the calibration harnesses.
 *
 * CHAPAEV-PLAN.md §6's best idea, unchanged: **difficulty is not different logic, it is noise.**
 * Every opponent runs the same search and picks the same way; what changes is how many shots it
 * looks at and how badly its hand shakes on the one it chose. That matters for how losing feels — an
 * easy bot that misses looks like a person misjudging a shot, where an easy bot built by making
 * worse CHOICES looks like a machine playing stupidly, and players can tell the difference
 * instantly.
 *
 * ## Easy / Medium / Hard are no longer what the game plays
 *
 * The player picks a CHARACTER now (`game/opponents.ts`), and a character carries these same three
 * numbers plus an evaluation bias the three levels never had. {@link BOT_LEVELS} is kept for one
 * reason and used by nobody in `src/`: **the calibration harnesses measure the solver, not the
 * cast.** `verify:bot`, `verify:balance`, `verify:branches`, `tune-weights` and the daily-puzzle
 * generator all want a fixed, named strength that does not move when a character is retuned — if
 * they read the cast, every measurement in the repo would shift the day somebody adjusted the
 * sergeant. Keeping a stable reference triple is what makes those numbers comparable across months.
 *
 * **Pure TypeScript, no Phaser.**
 */
import type { Opponent } from '../game/opponents'

const DEGREE = Math.PI / 180

export interface BotLevel {
  /** For a harness's own log line only — nothing in `bot/search.ts` reads it. */
  id: string
  /** Upper bound on shots evaluated per move. The search is exact within this budget — a bigger
   * number is a bot that has considered more, not one that considers better. */
  candidates: number
  /** Standard deviation of the angle error added to the chosen shot, in radians. */
  angleSigma: number
  /** Standard deviation of the power error, as a fraction of the chosen power. */
  powerSigma: number
}

export type ReferenceLevelId = 'easy' | 'medium' | 'hard'

/**
 * §6's table, verbatim, and now a MEASUREMENT REFERENCE rather than a thing the game offers.
 *
 * Do not retune these to match a character. They are the fixed rungs every `verify:*` number in this
 * repo was taken against, and moving one silently invalidates the recorded results rather than
 * improving anything.
 */
export const BOT_LEVELS: Record<ReferenceLevelId, BotLevel> = {
  easy: { id: 'easy', candidates: 60, angleSigma: 6 * DEGREE, powerSigma: 0.18 },
  medium: { id: 'medium', candidates: 200, angleSigma: 2.5 * DEGREE, powerSigma: 0.08 },
  hard: { id: 'hard', candidates: 600, angleSigma: 0.8 * DEGREE, powerSigma: 0.03 },
}

export function getBotLevel(id: ReferenceLevelId): BotLevel {
  return BOT_LEVELS[id]
}

/** A character's own three numbers, in the shape the search takes. Its `weights` are passed
 * separately (`bot/search.ts`'s `SearchOptions.weights`) because they are an argument to the
 * evaluation rather than to the candidate generation. */
export function personaLevel(character: Opponent): BotLevel {
  return {
    id: character.id,
    candidates: character.persona.candidates,
    angleSigma: character.persona.angleSigma,
    powerSigma: character.persona.powerSigma,
  }
}
