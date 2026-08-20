#!/usr/bin/env node
/**
 * How strong is each character, really?
 *
 * `npm run tournament [-- --rounds 200] [--duel-rounds 120] [--yardstick medium] [--duels-only]`
 *
 * ## What this is for, and what it is NOT for
 *
 * CLAUDE.md's rule stands and this script does not overturn it: **the ladder is fixed by character,
 * not by measurement.** A raw recruit does not become better than a marshal by measuring well. So
 * the output here is a DIAGNOSIS — it says which characters do not perform the rung they are written
 * on, and the fix for one of those is its own coefficients, never its index in `OPPONENTS`.
 *
 * That is also why this is `npm run tournament` rather than `npm run verify:something`: like
 * `scripts/tune-weights.mjs`, its output is a decision to be taken by a person, not an assertion
 * that passes or fails. Nothing here belongs in `npm test`.
 *
 * ## Why a fixed yardstick rather than a round robin
 *
 * A round robin over 18 characters is 153 pairs, and its scores are relative to the FIELD: retune one
 * character and every other character's number moves, which is precisely the property that makes a
 * recorded measurement worthless six months later. `bot/levels.ts`'s `BOT_LEVELS` exist for exactly
 * this — a fixed, named strength that does not move when a character is retuned — so every character
 * is measured against the same one and the numbers stay comparable across sessions.
 *
 * The round robin's one real advantage is that it can see non-transitivity (a habit that beats one
 * opponent and loses to another). That is bought much more cheaply by the second part below, which
 * plays each character against its own ladder neighbour: 17 pairs instead of 153, and it tests the
 * exact claim the ladder makes rather than an average over a field.
 *
 * ## The two things that would otherwise measure the wrong quantity
 *
 * 1. **Every seed is played twice with the opening shot swapped.** §3's first-move skew is worth
 *    ~62 points at Hard — far larger than the difference between two adjacent rungs — so an unpaired
 *    tournament would mostly measure who happened to start.
 * 2. **The branch of arms rotates with the seed.** A character measured on one branch is measured on
 *    one board; §4's five branches differ enough that a habit can be worth more on some than others.
 *
 * Each side draws its bot noise from its OWN generator, seeded from the seed and the side, so a
 * character plays identically in both orientations of a seed and the swap changes nothing but order.
 */
import { createBoardMetrics } from '../src/board/layout.ts'
import { createSimConfig, createState, liveDiscs } from '../src/sim/types.ts'
import { runToRest } from '../src/sim/shoot.ts'
import { enemyKnockouts, ownKnockouts } from '../src/sim/outcome.ts'
import { buildFormation, FORMATION_ORDER } from '../src/game/formations.ts'
import { CLASSIC_RULES } from '../src/game/rules.ts'
import { createRound, resolveShot } from '../src/game/round.ts'
import { OPPONENTS } from '../src/game/opponents.ts'
import { BOT_LEVELS, personaLevel } from '../src/bot/levels.ts'
import { DEFAULT_WEIGHTS } from '../src/bot/evaluate.ts'
import { createRandom } from '../src/bot/random.ts'
import { findShot } from '../src/bot/search.ts'

const args = process.argv.slice(2)
function num(name, fallback) {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = Number(args[i + 1])
  if (!Number.isFinite(v)) throw new Error(`--${name} needs a number`)
  return v
}
function str(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i < 0 ? fallback : args[i + 1]
}

const ROUNDS = num('rounds', 200)
const DUEL_ROUNDS = num('duel-rounds', 120)
const YARDSTICK_ID = str('yardstick', 'medium')
const DUELS_ONLY = args.includes('--duels-only')
/**
 * `--only a,b,c` restricts the ladder half to named characters.
 *
 * For re-measuring a fix: the full ladder is three quarters of an hour and a five-character A/B is
 * five minutes, and the two stay comparable because the yardstick they are both measured against
 * does not move. That is the whole argument for a fixed reference over a round robin, cashed in.
 */
const ONLY = (str('only', '') || '').split(',').filter(Boolean)

/**
 * `--tweak gunner.angleSigma=3.0 --tweak gunner.candidates=520` — a persona field, overridden before
 * anything runs.
 *
 * Same rule as `verify:branches`' `--friction` and `verify:balance`'s `--curve`: without it, choosing
 * between two candidate coefficients means editing `game/opponents.ts`, measuring, editing it back
 * and measuring again — two runs of two working trees, where the thing that differs between them is
 * only *probably* the one line intended. Here the difference is an argument.
 *
 * `angleSigma` is given in DEGREES, because that is the unit the file is authored in and a radian
 * typed by hand is a radian mistyped by hand.
 */
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--tweak') continue
  const [path, raw] = String(args[i + 1] ?? '').split('=')
  const [id, field] = String(path ?? '').split('.')
  const character = OPPONENTS.find((o) => o.id === id)
  if (!character || !field || raw === undefined) throw new Error(`--tweak wants <id>.<field>=<value>, got "${args[i + 1]}"`)
  if (!(field in character.persona)) throw new Error(`${id} has no persona field "${field}"`)
  const value = field === 'angleSigma' ? Number(raw) * (Math.PI / 180) : Number(raw)
  if (!Number.isFinite(value)) throw new Error(`--tweak ${path} needs a number`)
  console.log(`  !! OVERRIDE: ${id}.${field} ${field === 'angleSigma' ? `${(character.persona[field] * (180 / Math.PI)).toFixed(1)}° -> ${raw}°` : `${character.persona[field]} -> ${raw}`}`)
  character.persona[field] = value
}
const LADDER_ONLY = args.includes('--ladder-only')
if (!BOT_LEVELS[YARDSTICK_ID]) throw new Error(`--yardstick must be one of ${Object.keys(BOT_LEVELS).join(', ')}`)
if (ROUNDS % 2 !== 0 || DUEL_ROUNDS % 2 !== 0) throw new Error('round counts must be even: every seed is played from both orientations')

const METRICS = createBoardMetrics(8)
const SIM = createSimConfig(METRICS)
const RULES = CLASSIC_RULES
/** A round that has not finished by here is a stalemate, not a result — counted rather than dropped,
 * because a character that produces them is a character that cannot close. */
const MAX_SHOTS = 200
const OPPOSITE = { player: 'opponent', opponent: 'player' }

/** A character, or a reference level, in the shape the search takes. */
function seatFor(entry) {
  if (entry.persona) {
    return {
      id: entry.id,
      level: personaLevel(entry),
      weights: entry.persona.weights ? { ...DEFAULT_WEIGHTS, ...entry.persona.weights } : undefined,
      quirks: entry.persona.quirks,
    }
  }
  return { id: entry.id, level: entry, weights: undefined, quirks: undefined }
}

function playRound(branch, seats, randoms, first) {
  const state = createState(buildFormation(branch, METRICS, { piecesPerSide: RULES.piecesPerSide }))
  const round = createRound(first)

  const tally = {
    player: { shots: 0, enemyOff: 0, ownOff: 0 },
    opponent: { shots: 0, enemyOff: 0, ownOff: 0 },
  }
  let shots = 0

  while (!round.winner && shots < MAX_SHOTS) {
    const side = round.turn
    const seat = seats[side]
    const shot = findShot({
      state,
      side,
      level: seat.level,
      weights: seat.weights,
      quirks: seat.quirks,
      config: SIM,
      rules: RULES,
      random: randoms[side],
    })
    // Nothing to shoot at: the round cannot progress and calling it a stalemate is honest.
    if (!shot) break

    const outcome = runToRest(state, SIM, { shot })
    resolveShot(round, RULES, state, METRICS, outcome)

    shots++
    tally[side].shots++
    tally[side].enemyOff += enemyKnockouts(outcome)
    tally[side].ownOff += ownKnockouts(outcome)
  }

  return { winner: round.winner, shots, tally, live: { player: liveDiscs(state, 'player').length, opponent: liveDiscs(state, 'opponent').length } }
}

/**
 * `a` against `b` over `rounds` rounds, from a's point of view.
 *
 * `a` always sits on `'player'`; the formations are mirrored, so the side is not an asymmetry. What
 * IS one is who opens, and that is what the inner loop swaps.
 */
function contest(a, b, rounds) {
  const seatA = seatFor(a)
  const seatB = seatFor(b)
  const seats = { player: seatA, opponent: seatB }

  let wins = 0
  let decided = 0
  let stalled = 0
  let shots = 0
  const mine = { shots: 0, enemyOff: 0, ownOff: 0 }

  const seeds = rounds / 2
  for (let seed = 1; seed <= seeds; seed++) {
    const branch = FORMATION_ORDER[(seed - 1) % FORMATION_ORDER.length]
    for (const first of ['player', 'opponent']) {
      const randoms = { player: createRandom(seed * 2 + 1), opponent: createRandom(seed * 2 + 2) }
      const result = playRound(branch, seats, randoms, first)

      shots += result.shots
      mine.shots += result.tally.player.shots
      mine.enemyOff += result.tally.player.enemyOff
      mine.ownOff += result.tally.player.ownOff

      if (!result.winner) {
        stalled++
        continue
      }
      decided++
      if (result.winner === 'player') wins++
    }
  }

  const rate = decided === 0 ? 0 : wins / decided
  return {
    rate,
    se: decided === 0 ? 0 : Math.sqrt((rate * (1 - rate)) / decided) * 100,
    decided,
    stalled,
    shotsPerRound: shots / rounds,
    enemyPerShot: mine.shots === 0 ? 0 : mine.enemyOff / mine.shots,
    ownPerShot: mine.shots === 0 ? 0 : mine.ownOff / mine.shots,
  }
}

// -- reporting -------------------------------------------------------------------------------------

const pct = (x) => `${(x * 100).toFixed(1)}%`
const DEGREES = 180 / Math.PI

/** Spearman's rank correlation between the written ladder and the measured one. The right summary
 * statistic here: nobody can resolve rung 8 from rung 9 at any affordable sample size, and nobody
 * needs to — the question is whether the ORDER holds overall. */
function spearman(values) {
  const n = values.length
  const ranked = [...values.keys()].sort((i, j) => values[i] - values[j])
  const rank = new Array(n)
  ranked.forEach((original, position) => (rank[original] = position))
  let d2 = 0
  for (let i = 0; i < n; i++) d2 += (i - rank[i]) ** 2
  return 1 - (6 * d2) / (n * (n * n - 1))
}

const yardstick = BOT_LEVELS[YARDSTICK_ID]
console.log(`tournament: ${OPPONENTS.length} characters`)
console.log(`  ladder    ${ROUNDS} rounds each against the fixed '${YARDSTICK_ID}' reference (${ROUNDS / 2} seeds x 2 orientations, branch rotating)`)
console.log(`  duels     ${DUEL_ROUNDS} rounds for each of the ${OPPONENTS.length - 1} neighbour pairs`)
console.log(`  the ladder is fixed by CHARACTER — a mismatch below is a coefficient to fix, not a row to move\n`)

const ladder = []
if (!DUELS_ONLY) {
  console.log('rung character        budget  ang°  pwr    win%  ±SE    shots/rnd  enemy/shot  own/shot  stalled')
  OPPONENTS.forEach((character, i) => {
    if (ONLY.length > 0 && !ONLY.includes(character.id)) return
    const started = Date.now()
    const r = contest(character, yardstick, ROUNDS)
    ladder.push({ i, id: character.id, ...r })
    console.log(
      `${String(i).padStart(3)}  ${character.id.padEnd(15)} ${String(character.persona.candidates).padStart(4)}  ` +
        `${(character.persona.angleSigma * DEGREES).toFixed(1).padStart(4)}  ${character.persona.powerSigma.toFixed(2)}  ` +
        `${pct(r.rate).padStart(6)}  ±${r.se.toFixed(1).padStart(4)}  ${r.shotsPerRound.toFixed(1).padStart(8)}  ` +
        `${r.enemyPerShot.toFixed(2).padStart(9)}  ${r.ownPerShot.toFixed(2).padStart(8)}  ${String(r.stalled).padStart(6)}` +
        `   (${((Date.now() - started) / 1000).toFixed(0)}s)`,
    )
  })

  // Rank statistics over a hand-picked subset are statistics about the subset, and they would be
  // read as statistics about the ladder. Skipped rather than qualified.
  if (ONLY.length > 0) console.log('\n  (--only: rank correlation and inversions skipped, they mean nothing on a subset)')
  else {
  console.log('\n--- does the written order match the measured one? ---\n')
  const rho = spearman(ladder.map((row) => row.rate))
  console.log(`  Spearman rank correlation between rung and measured strength: ${rho.toFixed(3)}`)
  console.log('  (1.0 is a perfect match; this is the summary that matters, because two ADJACENT rungs')
  console.log('   cannot be resolved at any affordable sample size and do not need to be.)\n')

  // An inversion worth reporting is one the error bars do not cover: a character measurably weaker
  // than someone written BELOW it. Adjacent noise is not a finding.
  const inversions = []
  for (let i = 0; i < ladder.length; i++) {
    for (let j = i + 1; j < ladder.length; j++) {
      const lower = ladder[i]
      const higher = ladder[j]
      const gap = (lower.rate - higher.rate) * 100
      const combined = Math.hypot(lower.se, higher.se)
      if (gap > 2 * combined) inversions.push({ lower, higher, gap, combined })
    }
  }
  inversions.sort((a, b) => b.gap - a.gap)
  if (inversions.length === 0) {
    console.log('  no inversion outside two combined standard errors — the written order holds')
  } else {
    console.log(`  ${inversions.length} inversion(s) outside two combined standard errors, worst first:`)
    for (const inv of inversions.slice(0, 12)) {
      console.log(
        `    rung ${String(inv.lower.i).padStart(2)} ${inv.lower.id.padEnd(15)} beats ` +
          `rung ${String(inv.higher.i).padStart(2)} ${inv.higher.id.padEnd(15)} by ${inv.gap.toFixed(1)} points (±${inv.combined.toFixed(1)})`,
      )
    }
    if (inversions.length > 12) console.log(`    ... and ${inversions.length - 12} more`)
  }
  }
}

if (!LADDER_ONLY) {
  console.log('\n--- neighbour duels: does each rung actually beat the one below it? ---\n')
  console.log('pair                                    higher win%   ±SE    verdict')
  let held = 0
  let broken = 0
  for (let i = 0; i < OPPONENTS.length - 1; i++) {
    const lower = OPPONENTS[i]
    const higher = OPPONENTS[i + 1]
    const r = contest(higher, lower, DUEL_ROUNDS)
    // "Holds" means the higher rung is ahead by more than its own error bar. Anything inside it is
    // reported as indistinguishable rather than as a pass — two rungs the player cannot tell apart
    // is a real finding about the ladder, not a rounding detail.
    const ahead = (r.rate - 0.5) * 100
    const verdict = ahead > r.se ? 'holds' : ahead < -r.se ? 'INVERTED' : 'indistinguishable'
    if (verdict === 'holds') held++
    if (verdict === 'INVERTED') broken++
    console.log(
      `${String(i).padStart(2)}->${String(i + 1).padEnd(3)} ${lower.id.padEnd(15)} v ${higher.id.padEnd(15)} ` +
        `${pct(r.rate).padStart(8)}  ±${r.se.toFixed(1).padStart(4)}   ${verdict}`,
    )
  }
  console.log(`\n  ${held} of ${OPPONENTS.length - 1} neighbour steps hold, ${broken} inverted, the rest inside the error bar`)
}
