#!/usr/bin/env node
/**
 * Do the five branches of arms actually differ, or is it one game with a different sticker?
 *
 * `CHAPAEV-PLAN.md` §4 claims "five perceptibly different rounds out of one mass number and one
 * friction number". That claim had never been measured: it rests on the numbers in the table being
 * *written* differently, not on the difference reaching the player's hand. The range is narrow —
 * mass 0.7…2.5, friction ×0.85…×1.3 — and could sit entirely inside what nobody can feel.
 *
 * The diagnostic question and both thresholds are written down in §4 **before** any number here was
 * produced. Read that section before acting on this output; a threshold invented after the fact is
 * a threshold fitted to the number it was supposed to judge.
 *
 * ## The three parts, and why the first one is two numbers rather than one
 *
 * §4's two knobs do not act in the same place, so a single "travel" figure cannot express both:
 *
 * - **Friction acts alone**, on a disc with nothing in its way. Isolated by `freeRun`.
 * - **Mass acts only on contact**, in the exchange along the line of centres. It has *no effect
 *   whatsoever* on a free run — this solver's friction is Coulomb, a fixed decel per second along
 *   the velocity vector, so `d = v²/2a` has no `m` in it. A harness that measured free travel alone
 *   would report artillery and infantry as identical and conclude the branches do not differ, which
 *   is false and would be believed.
 *
 * So travel is measured twice: once through empty board, once into a rank of the branch's own
 * discs. **Both on a 24-cell board**, deliberately much larger than the real 8-cell one, because a
 * full-power shot travels ~11.5 cells (§11) — on a real board every branch would be truncated by
 * the edge at 8 and the metric would saturate into "they are all the same".
 *
 * Parts 2 and 3 are real self-play through the real bot, solver and round rules, on the real 8-cell
 * board, and answer the two halves of the "not sold" guard: is the branch still a game of skill
 * (Hard must beat Easy), and did the first-move skew of §3 move.
 *
 * NOT in `npm test`: parts 2 and 3 are minutes of solid computation. And per CLAUDE.md's "The Bot",
 * run it with nothing else going — a parallel job does not change these numbers, but it does change
 * any timing printed beside them.
 *
 *   node --import ./scripts/register-ts-loader.mjs scripts/verify-branches.mjs [--rounds N] [--travel-only]
 */
import { createBoardMetrics, gridToScreen } from '../src/board/layout.ts'
import { createSimConfig, createState, createDisc, liveDiscs, isMoving, DISC_RADIUS, CELL, MAX_SPEED } from '../src/sim/types.ts'
import { step } from '../src/sim/step.ts'
import { applyImpulse, runToRest, maxStepsFor } from '../src/sim/shoot.ts'
import { enemyKnockouts, ownKnockouts } from '../src/sim/outcome.ts'
import { BRANCH_PROFILES, FORMATION_ORDER, buildFormation, STACK_SPLIT_IMPULSE } from '../src/game/formations.ts'
import { CLASSIC_RULES } from '../src/game/rules.ts'
import { createRound, resolveShot, summarise } from '../src/game/round.ts'
import { BOT_LEVELS } from '../src/bot/levels.ts'
import { createRandom } from '../src/bot/random.ts'
import { findShot } from '../src/bot/search.ts'

const args = process.argv.slice(2)
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback
}
const TRAVEL_ONLY = args.includes('--travel-only')
/** Skip part 2. Its guard is a floor 30 points below where every branch actually sits, so re-paying
 * for it at the sample size part 3's guard needs is buying precision on a question already answered
 * with room to spare. */
const SKEW_ONLY = args.includes('--skew-only')
/**
 * Rounds per branch per part. 60 is about a minute a part on a desktop and is enough for part 2's
 * guard, which is a floor (60%) sitting 30 points from where every branch actually lands.
 *
 * **It is NOT enough for part 3's guard, and that is a property of the threshold rather than of this
 * default.** §4 fails a branch whose first-move skew moves by more than 5 points; at 60 rounds a
 * single figure carries a standard error of about ±6, so the difference of two runs carries about
 * ±8 — the threshold is narrower than the instrument. Getting the difference of two shares down to
 * a ±2 error needs a little over 1000 rounds a side. Re-measure a part 3 verdict at `--rounds 1000`
 * before believing it, and use `--branch` so that costs one branch rather than five.
 */
const ROUNDS = flag('rounds', 60)

/** Restrict every part to one branch, so a high-`--rounds` re-measurement of a suspect verdict does
 * not also pay for the four branches that were not in question. */
const BRANCH_ARG = args.indexOf('--branch')
const ONLY = BRANCH_ARG >= 0 ? args[BRANCH_ARG + 1] : null
if (ONLY && !FORMATION_ORDER.includes(ONLY)) {
  console.error(`unknown branch "${ONLY}" — have ${FORMATION_ORDER.join(', ')}`)
  process.exit(2)
}
const BRANCHES = ONLY ? [ONLY] : FORMATION_ORDER

/**
 * `--friction <value>`, applied to the `--branch` under test before anything runs.
 *
 * **The point is that both arms of an A/B are measured by one build.** Without this, comparing a
 * proposed friction against the value it replaces means editing `game/formations.ts`, measuring,
 * editing it back and measuring again — two runs of two different working trees, where the thing
 * that changed between them is only *probably* the one line intended. Here the difference is an
 * argument, and the code under test is byte-identical across both arms.
 */
const FRICTION = flag('friction', null)
const RESTITUTION = flag('restitution', null)
if ((FRICTION !== null || RESTITUTION !== null) && !ONLY) {
  console.error('--friction/--restitution need --branch: they override one branch, not all five')
  process.exit(2)
}
if (FRICTION !== null) {
  console.log(`\n  !! OVERRIDE: ${ONLY} frictionScale ${BRANCH_PROFILES[ONLY].frictionScale} -> ${FRICTION}`)
  BRANCH_PROFILES[ONLY].frictionScale = FRICTION
}
if (RESTITUTION !== null) {
  console.log(`\n  !! OVERRIDE: ${ONLY} restitution ${BRANCH_PROFILES[ONLY].restitution ?? 0.92} -> ${RESTITUTION}`)
  BRANCH_PROFILES[ONLY].restitution = RESTITUTION
}

/**
 * `--curve <k>`, the global power curve of §11 — `speed = maxSpeed * power ** k`.
 *
 * Here for the same reason `--friction` is: §11's measurement showed the curve helps four branches
 * and costs tanks 16 points of first-move skew, which makes tanks' own `frictionScale` (chosen at
 * x1.40 against the OLD curve) a stale number. Re-tuning it needs both arms measured under the new
 * curve by ONE build, and that is what this flag buys.
 */
const CURVE = flag('curve', null)
if (CURVE !== null) console.log(`
  !! OVERRIDE: powerCurve 1 -> ${CURVE}`)

const METRICS = createBoardMetrics(8)
const SIM = createSimConfig(METRICS, CURVE === null ? {} : { powerCurve: CURVE })
const RULES = CLASSIC_RULES

/** A round that has not finished by here is a stalemate, not a result — same convention as
 * `verify-balance.mjs`, and recorded rather than silently dropped. */
const MAX_SHOTS = 200

const OPPOSITE = { player: 'opponent', opponent: 'player' }

// -- part 1: travel ------------------------------------------------------------------------------

/** Cells a side of the test board. Far larger than the real 8 so that friction, not the edge,
 * decides where a disc stops. See the header. */
const TRAVEL_BOARD = 24
const TRAVEL_METRICS = createBoardMetrics(TRAVEL_BOARD)
const TRAVEL_SIM = createSimConfig(TRAVEL_METRICS)

/**
 * Cells between the shooter and its target(s). Enough that the shooter is still near full speed on
 * arrival rather than having already shed most of it to friction.
 *
 * **The shooter's own travel is NOT a usable metric and the first version of this file used it.**
 * It read 2.2-2.6 cells for all five branches, because a head-on hit into a rank of equal masses
 * transfers almost the whole velocity and the shooter stops dead a disc's width past this gap — so
 * the number was measuring `TARGET_GAP`, not the branch. What the shot DOES is measured instead.
 */
const TARGET_GAP = 3

/** A disc is counted as "moved" once it has been displaced by this many cells — past a nudge, and
 * comfortably past any positional-correction jitter at the moment of contact. */
const MOVED_CELLS = 0.5

function branchDisc(id, side, x, y, profile) {
  return createDisc({
    id,
    side,
    x,
    y,
    kind: profile.kind,
    mass: profile.mass,
    frictionScale: profile.frictionScale,
    restitution: profile.restitution,
    r: DISC_RADIUS * profile.radiusScale,
    splitImpulse: profile.kind === 'stack' ? STACK_SPLIT_IMPULSE : 0,
  })
}

/**
 * Path length of disc 0, in cells, from the shot until it rests or leaves.
 *
 * **Path length, not displacement.** A disc that hits a rank and glances off has gone somewhere,
 * and the straight-line distance from where it started understates that by however much it turned.
 * What the player is reading is how far the thing travelled.
 *
 * Stepped by hand rather than through `runToRest` for the same reason: the outcome record keeps
 * events, not a trajectory, and a trajectory is the whole measurement here.
 */
function measureTravel(state, config) {
  const shooter = state.discs[0]
  let travelled = 0
  let steps = 0
  const ceiling = maxStepsFor(config)

  while (isMoving(state) && steps < ceiling) {
    const x = shooter.x
    const y = shooter.y
    const alive = shooter.alive
    step(state, config)
    steps++
    // Only while it is still in play: `sim/step.ts` deliberately does not zero the velocity of a
    // disc it removes (the fall is thrown with it, see CLAUDE.md "Rendering the Discs"), so
    // counting past that point would measure the animation rather than the shot.
    if (alive && shooter.alive) travelled += Math.hypot(shooter.x - x, shooter.y - y)
  }

  return { cells: travelled / CELL, left: !shooter.alive }
}

/** Full power straight up-board, nothing in the way. Isolates `frictionScale`: Coulomb friction is
 * mass-independent, so this number is blind to mass by construction, not by oversight. */
function freeRun(profile) {
  const start = gridToScreen(TRAVEL_METRICS, TRAVEL_BOARD / 2, TRAVEL_BOARD - 2)
  const state = createState([branchDisc(0, 'player', start.x, start.y, profile)])
  applyImpulse(state.discs[0], -Math.PI / 2, 1)
  return measureTravel(state, TRAVEL_SIM)
}

/**
 * Total displacement of every disc a shot moved, and how many it moved.
 *
 * Displacement rather than path length here, and deliberately the opposite choice from
 * {@link measureTravel}: what matters about a struck disc is where it ENDED UP relative to where it
 * stood — that is what decides whether it is near an edge now — while what matters about the
 * shooter is how far it ran.
 */
function measureShot(state, config, targets) {
  const from = targets.map((d) => ({ x: d.x, y: d.y }))
  runToRest(state, config)

  let moved = 0
  let total = 0
  targets.forEach((d, i) => {
    // A disc knocked off the test board still moved, and how far it got before leaving is not the
    // interesting part — that it went is. Counted as moved, its displacement taken as measured.
    const cells = Math.hypot(d.x - from[i].x, d.y - from[i].y) / CELL
    total += cells
    if (cells >= MOVED_CELLS) moved++
  })
  return { moved, total }
}

/**
 * Full power into ONE disc of the same branch, head-on. How far does the struck disc go?
 *
 * **This is the test for whether `mass` does anything at all.** In an elastic exchange along the
 * line of centres the transferred velocity depends on the mass RATIO, and a round is always played
 * with the same branch on both sides — so the ratio is 1 whatever the mass number says, and theory
 * predicts this number is blind to mass and sensitive only to friction and restitution. §4 sells
 * mass as one of its two knobs, so it is worth knowing whether that is true rather than assuming
 * either way.
 */
function pushRun(profile) {
  const shooterRow = TRAVEL_BOARD - 2
  const start = gridToScreen(TRAVEL_METRICS, TRAVEL_BOARD / 2, shooterRow)
  const at = gridToScreen(TRAVEL_METRICS, TRAVEL_BOARD / 2, shooterRow - TARGET_GAP)

  const target = branchDisc(1, 'opponent', at.x, at.y, profile)
  const state = createState([branchDisc(0, 'player', start.x, start.y, profile), target])
  applyImpulse(state.discs[0], -Math.PI / 2, 1)

  return measureShot(state, TRAVEL_SIM, [target]).total
}

/**
 * §4 promises artillery "punches through a line". That is a claim about discs the shot meets ONE
 * BEHIND ANOTHER, so this queues them along the shot axis and counts how many move.
 *
 * **Not the same test as {@link spreadRun}, and confusing the two produced a wrong finding once
 * already.** In `spreadRun` the rank sits ACROSS the shot at one cell apart; a disc is 0.8 cells
 * across, so neighbours stand 0.2 cells clear of each other and a head-on hit physically cannot
 * reach any of them. Its `1/5` is the geometry of the test, not a fact about the game, and reading
 * it as "nothing penetrates" is reading the ruler instead of the thing measured.
 *
 * Touching, not spaced: a queue with gaps is a sequence of separate collisions, which is a
 * different (and easier) thing than driving through a packed line.
 */
function pierceRun(profile) {
  const shooterRow = TRAVEL_BOARD - 2
  const start = gridToScreen(TRAVEL_METRICS, TRAVEL_BOARD / 2, shooterRow)
  const discs = [branchDisc(0, 'player', start.x, start.y, profile)]
  const r = DISC_RADIUS * profile.radiusScale

  // Four in a column ahead of the shooter, each touching the one in front.
  let id = 1
  const head = start.y - TARGET_GAP * TRAVEL_METRICS.tile
  for (let i = 0; i < 4; i++) {
    discs.push(branchDisc(id++, 'opponent', start.x, head - i * 2 * r, profile))
  }

  const state = createState(discs)
  applyImpulse(state.discs[0], -Math.PI / 2, 1)
  return measureShot(state, TRAVEL_SIM, state.discs.slice(1))
}

/**
 * The same shot into a rank of five standing ACROSS the shot. Measures how much of a formation one
 * shot disturbs — see {@link pierceRun} for why this is not the penetration test and must not be
 * read as one.
 *
 * The rank is the branch's own profile rather than a fixed reference disc on purpose: §4's promise
 * is about how a ROUND of that branch plays, and in a round the thing being hit is the same stuff
 * as the thing hitting it. A fixed target would measure the branch against a disc that never
 * appears in its round.
 */
function spreadRun(profile) {
  const shooterRow = TRAVEL_BOARD - 2
  const start = gridToScreen(TRAVEL_METRICS, TRAVEL_BOARD / 2, shooterRow)
  const discs = [branchDisc(0, 'player', start.x, start.y, profile)]

  // Five across, centred on the shooter's column: wide enough that a glancing shot still meets a
  // neighbour, narrow enough to stay a line rather than a wall.
  let id = 1
  for (let d = -2; d <= 2; d++) {
    const at = gridToScreen(TRAVEL_METRICS, TRAVEL_BOARD / 2 + d, shooterRow - TARGET_GAP)
    discs.push(branchDisc(id++, 'opponent', at.x, at.y, profile))
  }

  const state = createState(discs)
  applyImpulse(state.discs[0], -Math.PI / 2, 1)
  return measureShot(state, TRAVEL_SIM, state.discs.slice(1))
}

// -- parts 2 and 3: self-play --------------------------------------------------------------------

/** One round of a single branch, played to the end by two bots. Everything about turn order,
 * penalties and victory comes from the real `resolveShot`. */
function playRound(formation, levels, randoms, first) {
  const state = createState(buildFormation(formation, METRICS, { piecesPerSide: RULES.piecesPerSide }))
  const round = createRound(first)

  let shots = 0
  let enemiesOff = 0
  let ownOff = 0

  while (!round.winner && shots < MAX_SHOTS) {
    const side = round.turn
    const shot = findShot({ state, side, level: levels[side], config: SIM, rules: RULES, random: randoms[side] })
    if (!shot) break

    const outcome = runToRest(state, SIM, { shot })
    resolveShot(round, RULES, state, METRICS, outcome)

    shots++
    enemiesOff += enemyKnockouts(outcome)
    ownOff += ownKnockouts(outcome)
  }

  return {
    winner: round.winner,
    first,
    shots,
    enemiesOff,
    ownOff,
    stalled: !round.winner,
    summary: round.winner ? summarise(round, RULES) : null,
    live: { player: liveDiscs(state, 'player').length, opponent: liveDiscs(state, 'opponent').length },
  }
}

/**
 * `rounds` rounds of one branch at one pairing, **every seed played twice with the opener swapped**.
 *
 * The swap is not optional and it is not for symmetry's sake: without it this measures the seed,
 * not the branch. Each side draws its noise from its own generator, seeded from the seed and the
 * side, so a side plays identically in both orientations and the swap changes the order and nothing
 * else. Same convention as `verify-balance.mjs`, for the same reason.
 */
function playBranch(formation, levelIds, rounds) {
  const levels = { player: BOT_LEVELS[levelIds[0]], opponent: BOT_LEVELS[levelIds[1]] }
  const tally = { rounds: 0, playerWon: 0, firstWon: 0, stalled: 0, shots: 0, enemiesOff: 0, ownOff: 0 }

  const pairs = Math.ceil(rounds / 2)
  for (let seed = 1; seed <= pairs; seed++) {
    for (const first of ['player', 'opponent']) {
      const randoms = { player: createRandom(seed * 2 + 1), opponent: createRandom(seed * 2 + 2) }
      const r = playRound(formation, levels, randoms, first)

      tally.rounds++
      tally.shots += r.shots
      tally.enemiesOff += r.enemiesOff
      tally.ownOff += r.ownOff
      if (r.stalled) {
        tally.stalled++
        continue
      }
      if (r.winner === 'player') tally.playerWon++
      if (r.winner === first) tally.firstWon++
    }
  }

  return tally
}

// -- reporting -----------------------------------------------------------------------------------

const pct = (n, d) => (d === 0 ? 0 : (n / d) * 100)
/** Standard error of a share, in points — several numbers here sit inside noise and saying so is
 * expected rather than hedging. */
const se = (n, d) => (d === 0 ? 0 : Math.sqrt(((n / d) * (1 - n / d)) / d) * 100)
const f = (x, w = 6, p = 1) => x.toFixed(p).padStart(w)

let failures = 0
function verdict(ok, message) {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${message}`)
}

console.log('\n=== Part 1: travel, on a 24-cell board so the edge never truncates it ===\n')
console.log('  branch      mass  fric  rest  rad    free    push   pierce   spread')

const travel = {}
for (const id of FORMATION_ORDER) {
  const p = BRANCH_PROFILES[id]
  const free = freeRun(p)
  const push = pushRun(p)
  const pierce = pierceRun(p)
  const spread = spreadRun(p)
  travel[id] = { free: free.cells, push, pierce: pierce.total, pierceN: pierce.moved, spread: spread.total }
  console.log(
    `  ${id.padEnd(10)} ${f(p.mass, 4, 2)}  ${f(p.frictionScale, 4, 2)}  ${f(p.restitution ?? 0.92, 4, 2)}  ${f(p.radiusScale, 4, 2)}  ${f(free.cells)}${free.left ? '*' : ' '}  ${f(push)}   ${pierce.moved}/4 ${f(pierce.total, 5)}   ${spread.moved}/5 ${f(spread.total, 5)}`,
  )
}
console.log('\n  (* left the 24-cell test board — the number is a floor, not a rest position)')

/**
 * §4's threshold 1, applied to each metric in turn. The plan names one primary metric; running it
 * showed no single number carries both knobs, so each is reported against the same thresholds and a
 * branch passes on the metric it is supposed to differ by.
 *
 * **Only the single-disc branches are held to it, and that is a deliberate amendment made after a
 * measurement proved the original unmeetable** — recorded in §4 rather than quietly applied here.
 * Artillery cannot satisfy both halves of §4 at once: travel separation from infantry needs
 * `frictionScale >= 1.25`, and the first-move-skew guard needs `<= 1.10` (1.25 measured +11.5
 * points over 400 rounds a side). The intersection is empty. What separates the two stacked
 * branches instead is `kind`, and `pierce` measures it directly — a stack absorbs a hard hit by
 * splitting, so it drives 2 discs of a queue against a single's 1, and carries them 2.6 cells
 * against 6.8. Holding them to a travel threshold on top demands a second, redundant difference and
 * charges the opening balance for it.
 */
const SINGLES = FORMATION_ORDER.filter((id) => BRANCH_PROFILES[id].kind === 'single')

function separation(label, pick) {
  console.log(`\n--- §4 threshold 1 on ${label} (single-disc branches only) ---\n`)
  const base = pick(travel.infantry)
  for (const id of SINGLES) {
    if (id === 'infantry') continue
    const delta = ((pick(travel[id]) - base) / base) * 100
    verdict(
      Math.abs(delta) >= 20,
      `${id.padEnd(10)} differs from infantry by ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% (need >=20%)`,
    )
  }

  const ordered = [...SINGLES].sort((a, b) => pick(travel[a]) - pick(travel[b]))
  for (let i = 1; i < ordered.length; i++) {
    const lo = pick(travel[ordered[i - 1]])
    const hi = pick(travel[ordered[i]])
    const gap = ((hi - lo) / lo) * 100
    verdict(gap >= 10, `${ordered[i - 1].padEnd(10)} -> ${ordered[i].padEnd(10)} gap ${gap.toFixed(1)}% (need >=10%)`)
  }

  // Reported, never gated: the stacked pair is separated by the split, and this is the number that
  // says so. A regression here IS meaningful — it would mean the split stopped doing the work the
  // travel threshold was excused from doing.
  const stacked = FORMATION_ORDER.filter((id) => BRANCH_PROFILES[id].kind === 'stack')
  console.log(
    `\n  stacked branches are separated by the split, not by travel — pierce: ` +
      stacked.map((id) => `${id} ${travel[id].pierceN}/4 @ ${travel[id].pierce.toFixed(1)}`).join(', ') +
      `, against infantry ${travel.infantry.pierceN}/4 @ ${travel.infantry.pierce.toFixed(1)}`,
  )
}

separation('free run (friction alone)', (t) => t.free)
separation('push (what the struck disc does)', (t) => t.push)

if (TRAVEL_ONLY) {
  console.log(`\n${failures === 0 ? 'OK' : `${failures} FAILED`} (travel only)\n`)
  process.exit(failures === 0 ? 0 : 1)
}

if (!SKEW_ONLY) {
console.log(`\n=== Part 2: is the branch still a game of skill? Hard vs Easy, ${ROUNDS} rounds each ===\n`)
console.log('  branch      hard win%      shots/round  enemies/shot  own/shot  stalled')

for (const id of BRANCHES) {
  const t = playBranch(id, ['hard', 'easy'], ROUNDS)
  const decided = t.rounds - t.stalled
  const win = pct(t.playerWon, decided)
  console.log(
    `  ${id.padEnd(10)} ${f(win, 5)} ±${se(t.playerWon, decided).toFixed(1)}   ${f(t.shots / t.rounds, 9)}     ${f(t.enemiesOff / t.shots, 8, 2)}  ${f(t.ownOff / t.shots, 8, 2)}  ${t.stalled}`,
  )
  verdict(win >= 60, `${id.padEnd(10)} Hard takes ${win.toFixed(1)}% of rounds from Easy (need >=60%)`)
}
}

console.log(`\n=== Part 3: first-shooter skew per branch, Hard vs Hard, ${ROUNDS} rounds each ===\n`)
console.log('  branch      first win%     shots/round')

let worstSe = 0
for (const id of BRANCHES) {
  const t = playBranch(id, ['hard', 'hard'], ROUNDS)
  const decided = t.rounds - t.stalled
  const err = se(t.firstWon, decided)
  worstSe = Math.max(worstSe, err)
  console.log(
    `  ${id.padEnd(10)} ${f(pct(t.firstWon, decided), 5)} ±${err.toFixed(1)}   ${f(t.shots / t.rounds, 9)}`,
  )
}

// The guard is a delta between two runs, so it carries BOTH runs' error — reported here rather than
// left for the reader to derive, because the default sample size makes it larger than the threshold
// and a verdict read straight off the two numbers would be read off noise.
const deltaErr = worstSe * Math.SQRT2
console.log(
  `\n  §4 threshold 2 (skew) is a DELTA against this branch's own baseline, not an absolute — record\n` +
    `  these figures before a physics edit and compare after. A move worse than 5 points fails.\n` +
    `\n  At --rounds ${ROUNDS} the difference of two runs carries about ±${deltaErr.toFixed(1)} points.` +
    (deltaErr > 5
      ? `  That is WIDER than the\n  5-point threshold: a verdict from these figures is not yet distinguishable from noise. Re-run the\n  branch in question at a higher --rounds before acting.`
      : `  That is inside the 5-point\n  threshold, so a verdict from these figures is real.`),
)

console.log(`\n${failures === 0 ? 'OK' : `${failures} check(s) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
