/**
 * Reading the pre-built daily puzzles.
 *
 * **Pure TypeScript, no Phaser.** The catalogue is produced by `npm run daily` and committed —
 * generating one puzzle costs about four seconds of solver time (CHAPAEV-PLAN.md §7's
 * generate-and-reject loop), which is a build step's price and not a phone's.
 *
 * The file wraps: past the end of the catalogue the game repeats it from the start rather than
 * running out. A stale build therefore degrades to old puzzles instead of to no puzzle at all,
 * which is the failure worth designing for — nobody rebuilds a shipped game on time.
 */
import { createBoardMetrics, type BoardMetrics } from '../board/layout'
import { createDisc, createState, type Disc, type SimState } from '../sim/types'
import { DAILY_BOARD_SIZE } from './puzzle'

export interface DailyRecord {
  date: string
  seed: number
  discs: { id: number; side: 'player' | 'opponent'; x: number; y: number }[]
  /** How many of the candidate shots clear it, from the build-time proof. Shown nowhere; kept so a
   * bug report can say which puzzle and how tight it was. */
  solutions: number
  candidates: number
}

export interface DailyCatalog {
  version: number
  board: number
  puzzles: DailyRecord[]
}

/** Path under `assets/`, for `Preloader`'s `this.load.json()`. */
export const DAILY_CATALOG_PATH = 'daily/puzzles.json'
export const DAILY_CATALOG_KEY = 'daily-puzzles'

/** Narrows a loaded JSON blob to a catalogue, or `null`. The file is committed and generated, so
 * this is a guard against a build that shipped without it rather than against corruption. */
export function asCatalog(raw: unknown): DailyCatalog | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Partial<DailyCatalog>
  if (!Array.isArray(candidate.puzzles) || candidate.puzzles.length === 0) return null
  return { version: candidate.version ?? 1, board: candidate.board ?? DAILY_BOARD_SIZE, puzzles: candidate.puzzles }
}

/**
 * The puzzle for a date.
 *
 * Looked up by date when the catalogue covers it, and otherwise by wrapping — days since the
 * catalogue's first entry, modulo its length. The wrap keeps the property that matters: everyone
 * gets the SAME puzzle on the same day, whether or not the build is current.
 */
export function puzzleFor(catalog: DailyCatalog, date: string): DailyRecord {
  const exact = catalog.puzzles.find((puzzle) => puzzle.date === date)
  if (exact) return exact

  const first = Date.parse(`${catalog.puzzles[0].date}T00:00:00Z`)
  const wanted = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(first) || Number.isNaN(wanted)) return catalog.puzzles[0]

  const days = Math.floor((wanted - first) / 86400000)
  // `%` keeps the sign of the dividend in JS, so a date BEFORE the catalogue starts would index
  // backwards off the front without the second modulo.
  const index = ((days % catalog.puzzles.length) + catalog.puzzles.length) % catalog.puzzles.length
  return catalog.puzzles[index]
}

/** Rebuilds a puzzle's board. Everything except position and side is the default disc — a daily has
 * no branches of arms and no stacks, which is what keeps it a test of one shot. */
export function boardFor(record: DailyRecord, metrics: BoardMetrics = createBoardMetrics(DAILY_BOARD_SIZE)): SimState {
  void metrics
  const discs: Disc[] = record.discs.map((saved) => createDisc({ id: saved.id, side: saved.side, x: saved.x, y: saved.y }))
  return createState(discs)
}
