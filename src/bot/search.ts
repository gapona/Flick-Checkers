/**
 * Choosing a shot: generate candidates, play every one of them out, take the best, then shake the
 * hand that fires it.
 *
 * **Pure TypeScript, no Phaser.** There is no minimax here and there could not be — a carrom board
 * has no move list to branch over, and nothing about an aim predicts its result. What replaces it is
 * brute force through the same solver the player's shots go through (GAME-PLAN.md §6), which is
 * only affordable because that solver is a pure function over a cloneable state.
 *
 * ## The search is exact; the hand is not
 *
 * §6's key idea, and the reason this is split the way it is: the search always finds the best
 * candidate it looked at, at every difficulty. Noise is added AFTERWARDS, to the shot it already
 * chose. An easy bot therefore aims at the right disc and misses, which reads as a person
 * misjudging; a bot made easy by choosing worse shots reads as a machine playing badly, and players
 * tell the difference immediately.
 *
 * ## Quirks narrow the search; they never widen what it can see
 *
 * {@link BotQuirks} is the axis that makes a cast of twelve worth having over a slider: which powers
 * a character is willing to use, how wide a fan it looks through, which enemies it goes for, and how
 * hard it pulls compared to what it aimed for. Every one of them is a PREFERENCE or a HABIT, and
 * every one can only take options away from the character or bias it toward a worse one — none can
 * show it a board the player is not looking at, hand it a second shot, or give it a better solver.
 * That is the invariant to keep: once a player suspects the opponent is cheating, every good shot it
 * plays reads as cheating too.
 *
 * ## Slicing
 *
 * A Hard search is ~600 solver runs. §6 requires that to be spread across frames on a budget
 * measured in milliseconds — `performance.now()`, never a frame count, because the whole point is to
 * not care how long a frame takes. {@link BotSearch.step} is that: it works until the budget is
 * spent and returns whether it is finished. Slicing changes only WHEN candidates are evaluated,
 * never which or in what order, so a sliced search and an unsliced one return the same shot.
 */
import { runToRest, type Shot } from '../sim/shoot'
import { cloneState, liveDiscs, opposite, type SimConfig, type SimState, type Side } from '../sim/types'
import { evaluate, type EvaluationWeights, type PenaltyRules } from './evaluate'
import type { BotLevel } from './levels'
import type { Random } from './random'

/** How far either side of a straight line at an enemy the bot is willing to look. §6: ±25°.
 *
 * The cone is the difference between a search that works and one that wastes itself: fired evenly
 * around the compass, the overwhelming majority of candidates are shots into empty board, and the
 * budget buys nothing. */
export const AIM_SPREAD = (25 * Math.PI) / 180

/** §6's "three levels of power". Not evenly spaced: the interesting choices live at the top, where a
 * shot has enough energy to reach and still move something. */
export const POWER_LEVELS = [0.45, 0.7, 1] as const

export interface Candidate {
  discId: number
  angle: number
  power: number
}

/**
 * A character's habits at the board, as opposed to its strength.
 *
 * Strength is `candidates` and the two sigmas; this is everything that makes two characters of the
 * SAME strength play unlike each other. Every field is optional and omitting all of them gives the
 * plain search, so a character that simply plays well or badly states nothing here.
 */
export interface BotQuirks {
  /**
   * Multiplies the power of the shot it decided on, before the noise.
   *
   * The character aims the shot it wanted and then consistently over- or under-hits it, which is a
   * habit rather than a lapse of judgement — and it is the single most VISIBLE quirk in this game,
   * because a shot 25% too hard is a disc that carries on off the far edge.
   */
  powerScale?: number
  /** The powers it is willing to consider at all, out of {@link POWER_LEVELS}. A cavalry charge that
   * never taps; a field cook who never drives. */
  powers?: readonly number[]
  /** Multiplier on the cone it looks through. Under 1 is tunnel vision — only near-straight shots;
   * over 1 is a character that considers angles nobody else bothers with. */
  aimSpread?: number
  /**
   * Which enemy discs it aims AT, out of the ones it can reach.
   *
   * - `nearest` (the default) — the closest, which is what a plain search does.
   * - `exposed` — the ones already near an edge. A scavenger that takes what is falling anyway.
   * - `deepest` — the ones furthest from any edge. A character that goes for the middle of the
   *   formation and refuses the easy pickings, which is worse play and a stronger personality.
   */
  targeting?: 'nearest' | 'exposed' | 'deepest'
}

/** How many enemies a single disc bothers aiming at, at the finest setting. Aiming from every disc
 * at every enemy spreads the budget so thin that no level gets useful angular resolution, and the
 * far ones are mostly duplicates of the near ones in direction anyway. Nearest first. */
const MAX_TARGETS_PER_DISC = 3

/**
 * The offsets sampled inside the ±{@link AIM_SPREAD} cone, for `count` samples.
 *
 * Two properties matter and both were got wrong first time round:
 *
 * 1. **The dead-on angle is always sampled.** An even, evenly-spaced fan across the cone contains no
 *    zero — so a bot given MORE budget could stop considering the straight shot at an enemy, which
 *    is usually the best one. `count` is forced odd for exactly this reason.
 * 2. **Samples cluster near the line.** A shot 3° off a straight line is a different shot; one 22°
 *    off is much the same miss as one 25° off. Squaring the parameter puts the resolution where it
 *    changes the outcome.
 */
function coneOffsets(count: number, spread: number): number[] {
  if (count <= 1) return [0]

  const offsets: number[] = []
  const half = (count - 1) / 2
  for (let i = 0; i < count; i++) {
    const t = (i - half) / half
    offsets.push(Math.sign(t) * t * t * spread)
  }
  return offsets
}

/** How far a point is from the nearest edge — the quantity the two targeting quirks sort on, and the
 * same one `evaluate.ts` prices. `0` with no config, which collapses both back to plain distance. */
function edgeDistance(x: number, y: number, config: SimConfig | undefined): number {
  if (!config) return 0
  return Math.min(x, y, config.boardW - x, config.boardH - y)
}

/**
 * Every shot the bot will consider, aimed in a cone at the nearest enemy discs.
 *
 * Deterministic — same board and same level give the same list in the same order, which is what lets
 * a whole tournament be replayed from a seed.
 */
export function generateCandidates(
  state: SimState,
  side: Side,
  level: BotLevel,
  options: { quirks?: BotQuirks; config?: SimConfig } = {},
): Candidate[] {
  const mine = liveDiscs(state, side)
  const enemies = liveDiscs(state, opposite(side))
  if (mine.length === 0 || enemies.length === 0) return []

  const quirks = options.quirks
  const powers = quirks?.powers?.length ? quirks.powers : POWER_LEVELS
  const spread = AIM_SPREAD * (quirks?.aimSpread ?? 1)

  // Budget goes: every own disc, at every power, at a few targets, at a few angles each. The angle
  // count is what a bigger budget actually buys — that is the resolution difference between a bot
  // that finds the gap and one that does not.
  const anglesPerDisc = Math.max(1, Math.floor(level.candidates / (mine.length * powers.length)))
  let targetCount = Math.min(enemies.length, Math.max(1, Math.min(MAX_TARGETS_PER_DISC, anglesPerDisc)))
  let samples = Math.max(1, Math.floor(anglesPerDisc / targetCount))
  if (samples % 2 === 0) samples -= 1
  const offsets = coneOffsets(Math.max(1, samples), spread)

  // Angular resolution is bought first, but a level whose budget cannot stretch to a wider fan
  // should spend the remainder on more targets rather than leave it unused — that is the difference
  // between Medium considering 72 shots and 192 of its allowed 200.
  //
  // **Except for a character with a targeting preference, which keeps its shortlist.** Widening to
  // every enemy on the board is exactly what erases the preference: with `targetCount` at
  // `enemies.length` the sort order below decides nothing at all, and `'exposed'` and `'deepest'`
  // become silent no-ops that a comment still claims are working. Measured, before this: a
  // `'deepest'` character with a large budget aimed at all eight enemies and its mean
  // distance-to-edge came out at the plain search's, to the pixel. A character that has decided
  // WHICH discs it wants looks harder at those, so the surplus goes into angles instead.
  const focused = quirks?.targeting !== undefined && quirks.targeting !== 'nearest'
  const sizeFor = (targets: number): number => mine.length * targets * offsets.length * powers.length
  if (!focused) {
    while (targetCount < enemies.length && sizeFor(targetCount + 1) <= level.candidates) targetCount++
  }

  // Which enemies get looked at. Distance from the shooter is the default, and it is the
  // tie-breaker for the other two — so a character with a preference still takes the nearer of two
  // equally exposed discs rather than picking by disc id, which would make its choice depend on the
  // order the formation happened to be built in.
  const rank = (disc: { x: number; y: number }, enemy: { x: number; y: number }): number => {
    const reach = Math.hypot(enemy.x - disc.x, enemy.y - disc.y)
    if (quirks?.targeting === 'exposed') return edgeDistance(enemy.x, enemy.y, options.config) * 100 + reach
    if (quirks?.targeting === 'deepest') return -edgeDistance(enemy.x, enemy.y, options.config) * 100 + reach
    return reach
  }

  const candidates: Candidate[] = []
  for (const disc of mine) {
    const targets = [...enemies].sort((a, b) => rank(disc, a) - rank(disc, b)).slice(0, targetCount)

    for (const enemy of targets) {
      const straight = Math.atan2(enemy.y - disc.y, enemy.x - disc.x)
      for (const offset of offsets) {
        for (const power of powers) {
          candidates.push({ discId: disc.id, angle: straight + offset, power })
        }
      }
    }
  }

  return trim(candidates, level.candidates)
}

/**
 * Cuts an over-long list down to the budget by even stride rather than by truncation.
 *
 * Truncating would keep every candidate for the first few discs and none for the rest, so the bot
 * would stop considering half its own pieces the moment the board got busy. A stride keeps the
 * spread across discs, enemies and powers alike.
 */
function trim(candidates: Candidate[], budget: number): Candidate[] {
  if (candidates.length <= budget) return candidates

  const stride = candidates.length / budget
  const kept: Candidate[] = []
  for (let i = 0; i < budget; i++) kept.push(candidates[Math.floor(i * stride)])
  return kept
}

export interface ScoredCandidate extends Candidate {
  score: number
}

export interface SearchOptions {
  state: SimState
  side: Side
  level: BotLevel
  config: SimConfig
  rules: PenaltyRules
  random: Random
  weights?: EvaluationWeights
  /** The character's habits. Omitted by the calibration harnesses, which measure the SOLVER and
   * would report a different number every time a character was retuned if they read one. */
  quirks?: BotQuirks
}

export interface BotSearch {
  /** Candidates evaluated so far, and how many there are in total. */
  readonly progress: { evaluated: number; total: number }
  readonly done: boolean
  /**
   * Evaluates candidates until `budgetMs` of wall time is spent, then yields. Returns `true` once
   * every candidate has been scored.
   *
   * At least one candidate is always evaluated per call, however small the budget: a budget too
   * tight to fit a single solver run would otherwise never finish, and a bot that never moves is a
   * worse failure than a frame that runs long.
   */
  step(budgetMs: number): boolean
  /** The best candidate found so far, before noise. `null` if none has been scored yet. */
  best(): ScoredCandidate | null
  /** The shot to actually take: the best candidate with §6's Gaussian noise applied. `null` if there
   * was nothing to consider — no discs of one side or the other. */
  shot(): Shot | null
}

/**
 * Starts a search over a snapshot of the board.
 *
 * The state is cloned once here and again per candidate, so the caller's board is never touched.
 */
export function createSearch(options: SearchOptions): BotSearch {
  const { side, level, config, rules, random, weights, quirks } = options
  const board = cloneState(options.state)
  const candidates = generateCandidates(board, side, level, { quirks, config })

  let index = 0
  let winner: ScoredCandidate | null = null

  const evaluateOne = (candidate: Candidate): void => {
    const trial = cloneState(board)
    const shot: Shot = { discId: candidate.discId, angle: candidate.angle, power: candidate.power }
    const outcome = runToRest(trial, config, { shot })
    const score = evaluate(board, trial, outcome, side, config, rules, weights)
    if (!winner || score > winner.score) winner = { ...candidate, score }
  }

  return {
    get progress() {
      return { evaluated: index, total: candidates.length }
    },
    get done() {
      return index >= candidates.length
    },

    step(budgetMs: number): boolean {
      const start = performance.now()
      do {
        if (index >= candidates.length) break
        evaluateOne(candidates[index++])
      } while (performance.now() - start < budgetMs)
      return index >= candidates.length
    },

    best(): ScoredCandidate | null {
      return winner
    },

    shot(): Shot | null {
      if (!winner) return null
      const chosen: ScoredCandidate = winner
      return {
        discId: chosen.discId,
        angle: chosen.angle + random.gaussian(level.angleSigma),
        // `powerScale` first, then the noise. The character decided on a power and then pulls
        // harder or softer than it meant to — a habit, applied to every shot, which is what makes it
        // read as a person rather than as a bad roll. Proportional noise, so a gentle tap is not
        // thrown as far off as a full-power drive; clamped because `applyImpulse` would clamp
        // anyway, and a bot aiming past the ceiling should be seen to be aiming AT it.
        power: Math.min(1, Math.max(0.05, chosen.power * (quirks?.powerScale ?? 1) * (1 + random.gaussian(level.powerSigma)))),
      }
    },
  }
}

/** Runs a whole search with no slicing — for tests, tournaments and the daily-puzzle generator,
 * none of which have frames to spread the work over. */
export function findShot(options: SearchOptions): Shot | null {
  const search = createSearch(options)
  while (!search.step(Number.POSITIVE_INFINITY)) {
    // `step` with an infinite budget finishes in one call; the loop is a formality.
  }
  return search.shot()
}
