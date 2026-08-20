#!/usr/bin/env node
// Generates the daily puzzles and writes them to public/assets/daily/puzzles.json (`npm run daily`).
//
// WHY AHEAD OF TIME. CHAPAEV-PLAN.md §7's generate-and-reject loop costs about four seconds per day
// on a desktop — hundreds of full solver runs to prove one layout solvable and not trivial. That is
// a fine price for a build step and an impossible one for a phone opening a game. §7 says the claim
// is "verifiable at build time", and this is where it gets verified.
//
// The output is COMMITTED, like the atlas and the sound set. A fresh clone does not need to run this
// script; regenerating produces byte-identical output for the same dates, because the whole pipeline
// is seeded from the date string and nothing in it reads a clock or Math.random.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BOT_LEVELS } from '../src/bot/levels.ts'
import { createBoardMetrics } from '../src/board/layout.ts'
import { DAILY_BOARD_SIZE, dateKey, generateDaily } from '../src/daily/puzzle.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public/assets/daily')
const OUT_FILE = path.join(OUT_DIR, 'puzzles.json')

/** Days to generate. A season's worth: long enough that nobody runs out mid-cycle, short enough that
 * regenerating is minutes rather than an afternoon. The game wraps around the list when it runs off
 * the end, so a stale build degrades to repeating old puzzles rather than to having none. */
const DAYS = Number(process.env.DAILY_DAYS ?? 60)

/** The first date in the catalogue. Fixed rather than "today", so re-running the script does not
 * silently produce a different file. */
const FIRST_DATE = process.env.DAILY_FROM ?? '2026-09-01'

const METRICS = createBoardMetrics(DAILY_BOARD_SIZE)
const LEVEL = BOT_LEVELS.hard

const start = new Date(`${FIRST_DATE}T00:00:00Z`)
if (Number.isNaN(start.getTime())) {
  console.error(`[daily] DAILY_FROM must be YYYY-MM-DD, got "${FIRST_DATE}"`)
  process.exit(1)
}

console.log(`[daily] generating ${DAYS} puzzles from ${FIRST_DATE} (this takes a few minutes)`)

const puzzles = []
const began = performance.now()
let hardest = { date: null, solutions: Infinity }

for (let day = 0; day < DAYS; day++) {
  const date = dateKey(new Date(start.getTime() + day * 86400000))
  const puzzle = generateDaily(date, LEVEL, METRICS)

  if (!puzzle) {
    // Loudly, and fatally: a gap in the catalogue is a day with no puzzle, which the game cannot
    // paper over. Better to fail the build than to ship it.
    console.error(`[daily] FAILED to generate a solvable puzzle for ${date}`)
    process.exit(1)
  }

  const share = puzzle.solutions / puzzle.candidates
  if (puzzle.solutions < hardest.solutions) hardest = { date, solutions: puzzle.solutions }

  puzzles.push({
    date,
    seed: puzzle.seed,
    // Only what the game needs to rebuild the board: positions to a tenth of a unit, and the side.
    // Everything else about a daily disc is the default, so storing it would be noise.
    discs: puzzle.discs.map((disc) => ({
      id: disc.id,
      side: disc.side,
      x: Math.round(disc.x * 10) / 10,
      y: Math.round(disc.y * 10) / 10,
    })),
    solutions: puzzle.solutions,
    candidates: puzzle.candidates,
  })

  process.stdout.write(`\r[daily] ${day + 1}/${DAYS}  ${date}  ${puzzle.solutions}/${puzzle.candidates} solve (${(share * 100).toFixed(1)}%)   `)
}

process.stdout.write('\n')

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, `${JSON.stringify({ version: 1, board: DAILY_BOARD_SIZE, puzzles }, null, 0)}\n`, 'utf8')

const seconds = (performance.now() - began) / 1000
console.log(
  `[daily] wrote ${puzzles.length} puzzles to ${path.relative(ROOT, OUT_FILE)} in ${seconds.toFixed(0)}s — ` +
    `tightest ${hardest.date} with ${hardest.solutions} solutions`,
)
