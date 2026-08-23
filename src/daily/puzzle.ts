/**
 * The daily puzzle: **clear the board in one shot** (GAME-PLAN.md §7).
 *
 * **Pure TypeScript, no Phaser.** This is the chunk that pays for the deterministic solver more
 * directly than anything else in the project — §7's whole idea is that the layout is generated from
 * a date and then PROVED solvable by running the same search the bot uses. A claim like "this puzzle
 * definitely has a one-shot solution" is only worth making if something checked it, and nothing can
 * check it without a solver that is a pure function of its inputs.
 *
 * ## The generate-and-reject loop
 *
 * 1. Lay out targets from a seed derived from the date.
 * 2. Ask the search whether any single shot clears them all.
 * 3. **No solution → throw the layout away** and try the next seed.
 * 4. **Too many solutions → throw it away too.** §7 is explicit: if a large share of candidate shots
 *    solve it, the puzzle is trivial, and a trivial puzzle wastes the day it was made for.
 *
 * What survives is a layout with a guaranteed answer that is not obvious. That is a strong, honest
 * and checkable claim, and `npm run verify:daily` re-proves it for a month of dates.
 */
import { createBoardMetrics, type BoardMetrics } from '../board/layout'
import { createRandom, type Random } from '../bot/random'
import { generateCandidates, POWER_LEVELS } from '../bot/search'
import type { BotLevel } from '../bot/levels'
import { runToRest } from '../sim/shoot'
import { cloneState, createDisc, createSimConfig, createState, DISC_RADIUS, liveDiscs, type Disc, type SimConfig, type SimState } from '../sim/types'

/** Cells per side of a daily board. The same 8×8 the game is played on — a puzzle on a different
 * board would be a different game, and the point is that the skill transfers. */
export const DAILY_BOARD_SIZE = 8

/** Discs the player is given. One: the puzzle is a single shot, so a second disc would only be
 * something to knock your own solution into. */
export const DAILY_SHOOTER_COUNT = 1

/** Targets to clear. Three is the smallest number that needs a plan rather than an aim. */
export const DAILY_TARGETS = 3

/**
 * A puzzle is rejected when more than this share of candidate shots solve it.
 *
 * §7's own number. It is the difference between "there is an answer" and "any reasonable shot is an
 * answer" — and the second is not a puzzle, it is a formality with a tick at the end.
 */
export const MAX_SOLUTION_SHARE = 0.15

/**
 * And rejected when FEWER than this share solve it.
 *
 * **Not in §7**, which sets a ceiling on triviality and no floor on cruelty. It needs one: the first
 * run of this generator happily produced a day whose only solution was one candidate shot in five
 * hundred, which is a puzzle no person will ever find and which would read as broken rather than
 * hard. A player aims continuously rather than from a grid, so the real solution window is wider
 * than the share suggests — but "wider than almost nothing" is still almost nothing.
 */
export const MIN_SOLUTION_SHARE = 0.01

/** How many seeds to try for one date before giving up. Generous: rejection is the normal case, and
 * a day with no puzzle is far worse than a slow build step. */
const MAX_ATTEMPTS = 900

export interface DailyPuzzle {
  /** `YYYY-MM-DD`, and the only input — the same date gives the same puzzle on every device, with
   * nothing transmitted and nothing stored. */
  date: string
  /** The seed that produced it, for reproducing a specific board from a bug report. */
  seed: number
  discs: Disc[]
  /** Candidate shots that clear the board, out of those tried. Both are reported so a build step can
   * show its working rather than merely asserting. */
  solutions: number
  candidates: number
}

/** `YYYY-MM-DD` -> a stable 32-bit seed. Pure arithmetic on the string, so the same date is the same
 * puzzle everywhere, forever, with no table to ship. */
export function seedForDate(date: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < date.length; i++) {
    hash ^= date.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** `YYYY-MM-DD` for a `Date`, in UTC — the day has to turn over at the same instant everywhere, or
 * two players in different time zones are on different puzzles and neither can discuss it. */
export function dateKey(at: Date): string {
  return at.toISOString().slice(0, 10)
}

export function dailyConfig(metrics: BoardMetrics = createBoardMetrics(DAILY_BOARD_SIZE)): SimConfig {
  return createSimConfig(metrics)
}

/**
 * One candidate layout: a shooter on the near rank, and a loose cluster of targets near the far
 * edge.
 *
 * **Clustered near the edge, not scattered across the half.** Three targets strewn over open board
 * cannot be cleared by one disc at all — the shot would have to carom between all three and put each
 * over a rim, which essentially never happens, and a generator asked for it simply runs out of
 * attempts. A cluster within reach of the far edge is the shape that makes a one-shot clear a matter
 * of finding the line rather than of luck: hit it right and the whole group goes over together.
 *
 * They are still kept a disc apart. Overlapping targets collapse the puzzle into "hit the lump",
 * which the triviality ceiling would reject anyway — after wasting the attempt.
 */
function layout(random: Random, metrics: BoardMetrics): Disc[] {
  const { tile, size, boardW } = metrics
  const discs: Disc[] = []
  let id = 0

  // The shooter sits on the back rank, anywhere across it.
  const shooterCol = Math.floor(random.next() * size)
  discs.push(
    createDisc({
      id: id++,
      side: 'player',
      x: (shooterCol + 0.5) * tile,
      y: (size - 0.5) * tile,
    }),
  )

  // The cluster's centre: somewhere across the width, close enough to the top edge that a disc
  // driven into it has somewhere to drive the group.
  const clusterX = tile * 1.5 + random.next() * (boardW - tile * 3)
  const clusterY = tile * (0.7 + random.next() * 0.55)
  const spread = tile * 1.1

  const minGap = DISC_RADIUS * 2.06
  let guard = 0
  while (discs.length < DAILY_SHOOTER_COUNT + DAILY_TARGETS && guard++ < 400) {
    const x = clusterX + (random.next() - 0.5) * 2 * spread
    const y = clusterY + (random.next() - 0.5) * 2 * spread * 0.7

    // Inside the board with a disc's clearance, so nothing starts already hanging over the rim —
    // a target that solves itself is not a target.
    if (x < tile * 0.6 || x > boardW - tile * 0.6) continue
    if (y < tile * 0.5 || y > metrics.boardH * 0.45) continue
    if (discs.some((other) => Math.hypot(other.x - x, other.y - y) < minGap)) continue

    discs.push(createDisc({ id: id++, side: 'opponent', x, y }))
  }

  return discs
}

/** Every shot worth trying at a puzzle — the bot's own candidate generator at its finest setting, so
 * "solvable" means "solvable by a shot the game itself would consider". */
function puzzleCandidates(state: SimState, level: BotLevel) {
  return generateCandidates(state, 'player', level)
}

export interface SolveReport {
  solutions: number
  candidates: number
}

/**
 * How many candidate shots clear every target.
 *
 * Stops early once the share of solutions passes the triviality ceiling — a puzzle that is already
 * disqualified does not need an exact count, and this loop runs hundreds of times per generated day.
 */
export function countSolutions(state: SimState, config: SimConfig, level: BotLevel, stopAtShare: number = MAX_SOLUTION_SHARE): SolveReport {
  const candidates = puzzleCandidates(state, level)
  if (candidates.length === 0) return { solutions: 0, candidates: 0 }

  const ceiling = Math.floor(candidates.length * stopAtShare) + 1
  let solutions = 0

  for (let i = 0; i < candidates.length; i++) {
    const trial = cloneState(state)
    runToRest(trial, config, { shot: candidates[i] })
    if (liveDiscs(trial, 'opponent').length === 0) {
      solutions++
      if (solutions > ceiling) return { solutions, candidates: candidates.length }
    }
  }

  return { solutions, candidates: candidates.length }
}

/**
 * The puzzle for a date, or `null` if no layout survived the loop.
 *
 * `null` is a real possibility and the caller must handle it rather than assume — which is exactly
 * why `verify:daily` exists as a build-time check rather than a runtime hope.
 */
export function generateDaily(date: string, level: BotLevel, metrics: BoardMetrics = createBoardMetrics(DAILY_BOARD_SIZE)): DailyPuzzle | null {
  const config = dailyConfig(metrics)
  const base = seedForDate(date)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // A fresh generator per attempt, seeded from the date AND the attempt number, so the sequence of
    // layouts a date produces is itself reproducible.
    const seed = (base + attempt * 0x9e3779b9) >>> 0
    const discs = layout(createRandom(seed), metrics)
    if (discs.length < DAILY_SHOOTER_COUNT + DAILY_TARGETS) continue

    const state = createState(discs)
    const report = countSolutions(state, config, level)
    if (report.candidates === 0) continue

    const share = report.solutions / report.candidates
    if (share < MIN_SOLUTION_SHARE) continue
    if (share > MAX_SOLUTION_SHARE) continue

    return { date, seed, discs, solutions: report.solutions, candidates: report.candidates }
  }

  return null
}

/** Whether a shot cleared the board — the puzzle's only win condition. */
export function isSolved(state: SimState): boolean {
  return liveDiscs(state, 'opponent').length === 0
}

/** Power levels a puzzle shot may use, mirroring the search's own so the proof and the play agree. */
export { POWER_LEVELS }
