#!/usr/bin/env node
/**
 * Does the side that shoots first win too often?
 *
 * Self-play through the REAL bot, the REAL solver and the REAL round rules — no model of the game,
 * the game itself. That is only possible because none of `src/sim/`, `src/game/` or `src/bot/`
 * imports Phaser, and this script adds nothing to any of them: every knob below is applied from out
 * here, so a measurement can never be an artefact of code written to be measured.
 *
 * ## Why the pairing matters more than the sample size
 *
 * **Every seed is played twice, with the two sides swapping who opens.** Without that this measures
 * the seed, not the first move: one board can favour whoever happens to start on it for reasons that
 * have nothing to do with going first, and 200 unpaired matches average those reasons in rather than
 * out. Each side also draws its bot noise from its OWN generator, seeded from the match seed and the
 * side, so a side plays the same way in both orientations and the only thing the swap changes is the
 * order.
 *
 * ## What the numbers are for
 *
 * `GAME-PLAN.md` §3 records why this is worth fixing at all, and it is not "fairness against the
 * bot" — against the bot the first move is a difficulty knob. It is the daily puzzle, `sendScore()`
 * and any future PvP. Read that section before acting on a number from here.
 *
 * NOT in `npm test`: 200 matches is minutes of solid computation per configuration.
 *
 *   node --import ./scripts/register-ts-loader.mjs scripts/verify-balance.mjs [--config X] [--matches N]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBoardMetrics } from '../src/board/layout.ts'
import { createSimConfig, createState, liveDiscs, CELL, MAX_SPEED_CELLS, FRICTION_DECEL_CELLS, POWER_CURVE } from '../src/sim/types.ts'
import { runToRest } from '../src/sim/shoot.ts'
import { buildFormation, FORMATION_ORDER } from '../src/game/formations.ts'
import { CLASSIC_RULES } from '../src/game/rules.ts'
import { createRound, resolveShot, summarise } from '../src/game/round.ts'
import { createMatch, recordRound, MATCH_ROUNDS } from '../src/game/match.ts'
import { BOT_LEVELS } from '../src/bot/levels.ts'
import { createRandom } from '../src/bot/random.ts'
import { findShot } from '../src/bot/search.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/**
 * Global physics overrides, for §11's friction question.
 *
 * They exist here for the same reason `verify:branches` has `--friction`: an A/B whose two arms come
 * from two states of the working tree is an A/B where the thing that changed between them is only
 * *probably* the one line intended. With these the difference is an argument, and the code under
 * test is byte-identical across both arms.
 *
 * Parsed up here rather than beside the rest of the argument handling at the bottom of the file,
 * because `SIM` is built at module scope and every match is played against it.
 */
const RAW_ARGS = process.argv.slice(2)
function physicsArg(name, fallback) {
  const i = RAW_ARGS.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = Number(RAW_ARGS[i + 1])
  if (!Number.isFinite(v)) throw new Error(`--${name} needs a number`)
  return v
}
const MAX_SPEED_ARG = physicsArg('max-speed', MAX_SPEED_CELLS)
const FRICTION_ARG = physicsArg('friction', FRICTION_DECEL_CELLS)
const CURVE_ARG = physicsArg('curve', POWER_CURVE)
const PHYSICS_OVERRIDDEN = MAX_SPEED_ARG !== MAX_SPEED_CELLS || FRICTION_ARG !== FRICTION_DECEL_CELLS || CURVE_ARG !== POWER_CURVE
const PHYSICS_LABEL = `maxSpeed ${MAX_SPEED_ARG}, friction ${FRICTION_ARG}, curve ${CURVE_ARG}`

const METRICS = createBoardMetrics(8)
const SIM = createSimConfig(METRICS, {
  maxSpeed: MAX_SPEED_ARG * CELL,
  frictionDecel: FRICTION_ARG * CELL,
  powerCurve: CURVE_ARG,
})

/** A round that has not finished by here is a stalemate, not a result — recorded as one rather than
 * silently dropped, because a rule change that produces them is a rule change that has failed. */
const MAX_SHOTS = 200

// -- what a "real" match costs in wall-clock ----------------------------------------------------
//
// Reported as an estimate built from named constants rather than as a measurement, because self-play
// has no human in it and the human is most of the clock. Both numbers are deliberately generous: the
// question this answers is "could a five-round match run long", and an optimistic estimate cannot
// answer it.
/** A person choosing a disc, pulling back, judging the line and releasing. */
const HUMAN_SHOT_SECONDS = 4.5
/** The bot's frame-sliced search plus the beat that makes it read as a decision (§6). */
const BOT_SHOT_SECONDS = 1.2
/** Result panel between rounds, plus the board being set up. */
const BETWEEN_ROUNDS_SECONDS = 6

const CONFIGURATIONS = {
  A: { label: 'Hard vs Hard, extraShot ON', levels: ['hard', 'hard'], extraShot: true },
  B: { label: 'Hard vs Hard, extraShot OFF', levels: ['hard', 'hard'], extraShot: false },
  D: { label: 'Medium vs Medium, extraShot ON', levels: ['medium', 'medium'], extraShot: true },
  Dn: { label: 'Medium vs Medium, extraShot OFF', levels: ['medium', 'medium'], extraShot: false },
  E: { label: 'Easy vs Easy, extraShot ON', levels: ['easy', 'easy'], extraShot: true },
  En: { label: 'Easy vs Easy, extraShot OFF', levels: ['easy', 'easy'], extraShot: false },
}

const OPPOSITE = { player: 'opponent', opponent: 'player' }

/**
 * One round, played out.
 *
 * `first` is who opens it. Everything else — turn order, penalties, who wins — comes from the real
 * `resolveShot`, so a rule flag changes this function's behaviour without this function knowing the
 * flag exists.
 */
function playRound(formation, rules, levels, randoms, first, advance) {
  const state = createState(buildFormation(formation, METRICS, { piecesPerSide: rules.piecesPerSide, advance }))
  const round = createRound(first)

  let shots = 0
  let simSeconds = 0
  const shotsBySide = { player: 0, opponent: 0 }
  /** Consecutive `extraShot` results, and the longest such run in this round. */
  let chain = 0
  let longestChain = 0
  const chains = []

  while (!round.winner && shots < MAX_SHOTS) {
    const side = round.turn
    const shot = findShot({ state, side, level: levels[side], config: SIM, rules, random: randoms[side] })
    // A side with no candidate has nothing to shoot at — the round cannot progress and calling it a
    // stalemate is honest.
    if (!shot) break

    const outcome = runToRest(state, SIM, { shot })
    const resolution = resolveShot(round, rules, state, METRICS, outcome)

    shots++
    shotsBySide[side]++
    simSeconds += outcome.elapsed

    if (resolution.reason === 'extraShot') {
      chain++
      longestChain = Math.max(longestChain, chain)
    } else if (chain > 0) {
      chains.push(chain)
      chain = 0
    }
  }
  if (chain > 0) chains.push(chain)

  const summary = round.winner ? summarise(round, rules) : null
  const loser = round.winner ? OPPOSITE[round.winner] : null

  // Which way did §3's last-hope strike actually point?
  //
  // **Read off `summarise`'s decision, not off the conditions that feed it.** The first version of
  // this counter tested `round.lastHope !== loser` — the SITUATION the old bug needed — and went on
  // reporting 9.8% after the bug was fixed, because the situation still occurs constantly; it is
  // only the consequence that changed. A diagnostic that measures the premise instead of the outcome
  // will happily certify a fix as having done nothing.
  const overrides = summary && summary.firstNextRound !== loser

  return {
    winner: round.winner,
    summary,
    first,
    shots,
    simSeconds,
    stalled: !round.winner,
    // §3's runaway: the loser never really got to play. Measured on the LOSER's own shot count, not
    // on the round's total, because a long round the loser spent watching is the case of interest.
    loserShots: loser ? shotsBySide[loser] : null,
    chains,
    longestChain,
    lastHopeOverride: Boolean(overrides),
    live: { player: liveDiscs(state, 'player').length, opponent: liveDiscs(state, 'opponent').length },
  }
}

/** A whole match: five rounds, one per branch of arms (§4). */
function playMatch(rules, levels, seed, matchFirst) {
  const match = createMatch(rules.id, matchFirst)
  // Per SIDE, not per match: a side then plays identically in both orientations of the same seed, so
  // swapping who opens changes the order and nothing else.
  const randoms = { player: createRandom(seed * 2 + 1), opponent: createRandom(seed * 2 + 2) }

  const rounds = []
  for (let i = 0; i < MATCH_ROUNDS && !match.winner; i++) {
    const round = playRound(FORMATION_ORDER[match.roundIndex], rules, levels, randoms, match.first, match.advance)
    rounds.push({ ...round, formation: FORMATION_ORDER[match.roundIndex] })
    if (!round.summary) break
    recordRound(match, round.summary, rules.advanceOnCleanWin)
  }

  return { rounds, winner: match.winner, matchFirst }
}

function run(configId, matches) {
  const config = CONFIGURATIONS[configId]
  const rules = { ...CLASSIC_RULES, extraShotOnKnockout: config.extraShot }
  const levels = { player: BOT_LEVELS[config.levels[0]], opponent: BOT_LEVELS[config.levels[1]] }

  const tally = {
    rounds: 0,
    roundsFirstWon: 0,
    roundsStalled: 0,
    matches: 0,
    matchesFirstWon: 0,
    matchesUndecided: 0,
    runaway: 0,
    lastHopeToWinner: 0,
    shots: 0,
    maxShots: 0,
    simSeconds: 0,
    chainTotal: 0,
    chainCount: 0,
    chainMax: 0,
    byFormation: Object.fromEntries(FORMATION_ORDER.map((f) => [f, { rounds: 0, firstWon: 0, shots: 0 }])),
  }

  // Half as many seeds as matches: every seed is played twice, once from each orientation.
  const seeds = matches / 2
  const started = Date.now()

  for (let seed = 1; seed <= seeds; seed++) {
    for (const matchFirst of ['player', 'opponent']) {
      const result = playMatch(rules, levels, seed, matchFirst)

      tally.matches++
      if (!result.winner) tally.matchesUndecided++
      else if (result.winner === matchFirst) tally.matchesFirstWon++

      for (const round of result.rounds) {
        tally.rounds++
        tally.shots += round.shots
        tally.maxShots = Math.max(tally.maxShots, round.shots)
        tally.simSeconds += round.simSeconds
        tally.chainMax = Math.max(tally.chainMax, round.longestChain)
        for (const c of round.chains) {
          tally.chainTotal += c
          tally.chainCount++
        }

        const branch = tally.byFormation[round.formation]
        branch.rounds++
        branch.shots += round.shots

        if (round.stalled) {
          tally.roundsStalled++
          continue
        }
        if (round.winner === round.first) {
          tally.roundsFirstWon++
          branch.firstWon++
        }
        if (round.loserShots !== null && round.loserShots <= 1) tally.runaway++
        if (round.lastHopeOverride) tally.lastHopeToWinner++
      }
    }
  }

  tally.wallSeconds = (Date.now() - started) / 1000
  return { configId, config, tally }
}

// -- reporting ----------------------------------------------------------------------------------

const pct = (n, d) => (d === 0 ? '  n/a' : `${((n / d) * 100).toFixed(1)}%`)
const f1 = (n) => n.toFixed(1)
const f2 = (n) => n.toFixed(2)

/** Shots × the pause each one costs, plus the flight time the solver actually produced. Strict
 * alternation makes the human/bot split exactly even; under `extraShot` it is not, so the split is
 * taken from the measured shot counts rather than assumed. */
function estimateMatchMinutes(tally) {
  const shotsPerRound = tally.shots / tally.rounds
  const simPerRound = tally.simSeconds / tally.rounds
  const perShot = (HUMAN_SHOT_SECONDS + BOT_SHOT_SECONDS) / 2
  const roundSeconds = shotsPerRound * perShot + simPerRound
  return { roundSeconds, matchMinutes: (roundSeconds * MATCH_ROUNDS + BETWEEN_ROUNDS_SECONDS * (MATCH_ROUNDS - 1)) / 60 }
}

function report(results) {
  const lines = []
  const say = (s = '') => {
    lines.push(s)
    console.log(s)
  }

  say('cfg  configuration                     first-win  first-win   runaway  shots/rnd  chain      round   match')
  say('                                        (rounds)   (matches)                       avg/max     sec     min')
  for (const { configId, config, tally } of results) {
    const t = tally
    const { roundSeconds, matchMinutes } = estimateMatchMinutes(t)
    const chainAvg = t.chainCount === 0 ? 0 : t.chainTotal / t.chainCount
    say(
      `${configId.padEnd(4)} ${config.label.padEnd(33)} ` +
        `${pct(t.roundsFirstWon, t.rounds - t.roundsStalled).padStart(8)}   ` +
        `${pct(t.matchesFirstWon, t.matches - t.matchesUndecided).padStart(8)}   ` +
        `${pct(t.runaway, t.rounds - t.roundsStalled).padStart(7)}  ` +
        `${f1(t.shots / t.rounds).padStart(9)}  ` +
        `${(f2(chainAvg) + '/' + t.chainMax).padStart(9)}  ` +
        `${f1(roundSeconds).padStart(6)}  ` +
        `${f1(matchMinutes).padStart(6)}`,
    )
  }

  say('')
  say('by branch of arms — first-shooter win rate (the compound is not the same for 1.0 mass and 2.5)')
  say(`     ${FORMATION_ORDER.map((f) => f.padStart(10)).join('')}`)
  for (const { configId, tally } of results) {
    say(`${configId.padEnd(4)} ` + FORMATION_ORDER.map((f) => pct(tally.byFormation[f].firstWon, tally.byFormation[f].rounds).padStart(10)).join(''))
  }

  say('')
  say('shots per round by branch')
  say(`     ${FORMATION_ORDER.map((f) => f.padStart(10)).join('')}`)
  for (const { configId, tally } of results) {
    say(`${configId.padEnd(4)} ` + FORMATION_ORDER.map((f) => f1(tally.byFormation[f].shots / tally.byFormation[f].rounds).padStart(10)).join(''))
  }

  say('')
  for (const { configId, tally } of results) {
    const notes = []
    if (tally.roundsStalled > 0) notes.push(`${tally.roundsStalled} stalled rounds`)
    if (tally.matchesUndecided > 0) notes.push(`${tally.matchesUndecided} undecided matches`)
    if (tally.lastHopeToWinner > 0) notes.push(`lastHopeStrike gave the next opening shot to the round WINNER ${tally.lastHopeToWinner}x (${pct(tally.lastHopeToWinner, tally.rounds)})`)
    say(`${configId}: ${tally.matches} matches, ${tally.rounds} rounds, max ${tally.maxShots} shots in a round, ${f1(tally.wallSeconds)}s wall${notes.length ? ' — ' + notes.join(', ') : ''}`)
  }

  return lines.join('\n')
}

// -- entry --------------------------------------------------------------------------------------

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}

const matches = Number(argOf('--matches', 200))
if (matches % 2 !== 0) throw new Error('--matches must be even: every seed is played from both orientations')

const wanted = argOf('--config', 'all')
const ids = wanted === 'all' ? Object.keys(CONFIGURATIONS) : wanted.split(',')
for (const id of ids) if (!CONFIGURATIONS[id]) throw new Error(`unknown configuration ${id}; have ${Object.keys(CONFIGURATIONS).join(', ')}`)

console.log(`verify-balance: ${ids.join(', ')} at ${matches} matches each (${matches / 2} seeds x 2 orientations)\n`)
if (PHYSICS_OVERRIDDEN) console.log(`  !! PHYSICS OVERRIDE: ${PHYSICS_LABEL}\n`)

const results = ids.map((id) => {
  process.stderr.write(`  running ${id}...\n`)
  return run(id, matches)
})

const text = report(results)

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dir = path.join(ROOT, 'build', 'balance')
mkdirSync(dir, { recursive: true })
const file = path.join(dir, `balance-${ids.join('_')}-${stamp}.txt`)
const header = `verify-balance ${ids.join(', ')} @ ${matches} matches${PHYSICS_OVERRIDDEN ? ` -- ${PHYSICS_LABEL}` : ''}`
writeFileSync(file, `${header}\n\n${text}\n`, 'utf8')
console.log(`\nwritten to ${path.relative(ROOT, file)}`)
