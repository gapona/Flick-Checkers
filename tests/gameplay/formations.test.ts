/**
 * The branches of arms (CHAPAEV-PLAN.md §4) and the stacks two of them field (§2's trap 2).
 *
 * S8's definition of done is "five rounds are playable, a stack comes apart at its threshold", and
 * both halves are here — the five rounds are played through the real solver and the real round
 * rules, not asserted about.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { isDarkSquare } from '../../src/board/layout'
import { BRANCH_PROFILES, FORMATION_ORDER, STACK_SPLIT_IMPULSE, buildFormation } from '../../src/game/formations'
import { CLASSIC_RULES } from '../../src/game/rules'
import { createRound, resolveShot } from '../../src/game/round'
import { runToRest } from '../../src/sim/shoot'
import { step } from '../../src/sim/step'
import { createOutcome } from '../../src/sim/outcome'
import { CELL, DISC_RADIUS, createDisc, createState, liveDiscs, opposite } from '../../src/sim/types'
import { METRICS, config } from './helpers'

const PIECES = 8

describe('the five branches', () => {
  test('every branch fields both sides, and the stacked ones field half as many discs', () => {
    // A stack is one disc worth two pieces, which is why artillery and tanks put four on the board
    // rather than eight. See `formations.ts` on why a literal four-piece tank is not modelled.
    for (const id of FORMATION_ORDER) {
      const discs = buildFormation(id, METRICS, { piecesPerSide: PIECES })
      const expected = BRANCH_PROFILES[id].discsPerSide(PIECES)

      assert.equal(discs.filter((d) => d.side === 'player').length, expected, `${id}: player`)
      assert.equal(discs.filter((d) => d.side === 'opponent').length, expected, `${id}: opponent`)
      assert.equal(new Set(discs.map((d) => d.id)).size, discs.length, `${id}: ids must be unique`)
    }
  })

  test('each branch carries its own mass and friction — §4 is two numbers per branch', () => {
    for (const id of FORMATION_ORDER) {
      const profile = BRANCH_PROFILES[id]
      for (const disc of buildFormation(id, METRICS, { piecesPerSide: PIECES })) {
        assert.equal(disc.mass, profile.mass, `${id}: mass`)
        assert.equal(disc.frictionScale, profile.frictionScale, `${id}: friction`)
        assert.ok(Math.abs(disc.r - DISC_RADIUS * profile.radiusScale) < 1e-9, `${id}: radius`)
      }
    }
  })

  test('the branches are actually different from each other, not five names for one disc', () => {
    const masses = new Set(FORMATION_ORDER.map((id) => BRANCH_PROFILES[id].mass))
    assert.ok(masses.size >= 4, `only ${masses.size} distinct masses across five branches`)
    assert.ok(BRANCH_PROFILES.tanks.mass > BRANCH_PROFILES.infantry.mass * 2, 'a tank should be a battering ram')
    assert.ok(BRANCH_PROFILES.planes.mass < BRANCH_PROFILES.infantry.mass, 'a plane should be light')
    assert.ok(BRANCH_PROFILES.cavalry.frictionScale < 1, 'cavalry should run further')
    assert.ok(BRANCH_PROFILES.tanks.frictionScale > 1, 'a tank should stop short')
    assert.ok((BRANCH_PROFILES.planes.restitution ?? 0) > BRANCH_PROFILES.infantry.mass * 0.9, 'a plane should ricochet')
  })

  test('every disc starts on the board, and no two start overlapping', () => {
    // A formation that begins in contact would rearrange itself on the opening frame, before anyone
    // has shot — see the solver's own CONTACT_EPSILON test.
    for (const id of FORMATION_ORDER) {
      const discs = buildFormation(id, METRICS, { piecesPerSide: PIECES })
      const board = config()
      for (const disc of discs) {
        assert.ok(disc.x > 0 && disc.x < board.boardW, `${id}: disc ${disc.id} off the board in x`)
        assert.ok(disc.y > 0 && disc.y < board.boardH, `${id}: disc ${disc.id} off the board in y`)
      }
      for (let i = 0; i < discs.length; i++) {
        for (let j = i + 1; j < discs.length; j++) {
          const gap = Math.hypot(discs[i].x - discs[j].x, discs[i].y - discs[j].y) - discs[i].r - discs[j].r
          assert.ok(gap > -1e-9, `${id}: discs ${discs[i].id} and ${discs[j].id} start overlapping by ${(-gap).toFixed(2)}`)
        }
      }
    }
  })

  test('the two sides are mirror images', () => {
    for (const id of FORMATION_ORDER) {
      const discs = buildFormation(id, METRICS, { piecesPerSide: PIECES })
      const mine = discs.filter((d) => d.side === 'player').map((d) => `${d.x.toFixed(3)}:${(METRICS.boardH - d.y).toFixed(3)}`).sort()
      const theirs = discs.filter((d) => d.side === 'opponent').map((d) => `${d.x.toFixed(3)}:${d.y.toFixed(3)}`).sort()
      assert.deepEqual(mine, theirs, `${id}: the two formations must mirror`)
    }
  })

  test('cavalry sets up on the dark squares of two rows', () => {
    const discs = buildFormation('cavalry', METRICS, { piecesPerSide: PIECES }).filter((d) => d.side === 'player')
    const rows = new Set<number>()
    for (const disc of discs) {
      const col = Math.floor(disc.x / METRICS.tile)
      const row = Math.floor(disc.y / METRICS.tile)
      rows.add(row)
      assert.ok(isDarkSquare(col, row), `cavalry disc at ${col},${row} is not on a dark square`)
    }
    assert.equal(rows.size, 2, 'cavalry should occupy exactly two rows')
  })

  test('planes start deeper into the board than anyone else', () => {
    const depthOf = (id: (typeof FORMATION_ORDER)[number]) =>
      Math.min(...buildFormation(id, METRICS, { piecesPerSide: PIECES }).filter((d) => d.side === 'player').map((d) => d.y))

    assert.ok(depthOf('planes') < depthOf('infantry'), 'planes should be further forward')
    assert.ok(depthOf('planes') < depthOf('cavalry'))
  })

  test('advanceOnCleanWin moves a formation forward, and only that side', () => {
    // §3 earns it, §4's formations spend it — this is the one place the flag has an effect.
    const plain = buildFormation('infantry', METRICS, { piecesPerSide: PIECES })
    const advanced = buildFormation('infantry', METRICS, { piecesPerSide: PIECES, advance: { player: 1 } })

    const frontOf = (discs: typeof plain, side: 'player' | 'opponent') =>
      side === 'player' ? Math.min(...discs.filter((d) => d.side === side).map((d) => d.y)) : Math.max(...discs.filter((d) => d.side === side).map((d) => d.y))

    assert.ok(frontOf(advanced, 'player') < frontOf(plain, 'player'), 'the player should have moved up the board')
    assert.equal(frontOf(advanced, 'opponent'), frontOf(plain, 'opponent'), 'the opponent must not have moved')
    assert.ok(Math.abs(frontOf(plain, 'player') - frontOf(advanced, 'player') - METRICS.tile) < 1e-9, 'exactly one row')
  })
})

describe('stacks (§2, trap 2)', () => {
  /**
   * A stack with a striker almost touching it, closing at `speedCells` per second.
   *
   * Almost touching on purpose: friction stops a disc in `v²/2a`, so a slow shot from across the
   * board never arrives at all — a "gentle hit" set up at range is really a test of it missing.
   */
  function headOn(speedCells: number) {
    const stack = createDisc({
      id: 0,
      side: 'opponent',
      x: 4.5 * CELL,
      y: 3 * CELL,
      kind: 'stack',
      mass: BRANCH_PROFILES.artillery.mass,
      r: DISC_RADIUS * BRANCH_PROFILES.artillery.radiusScale,
      splitImpulse: STACK_SPLIT_IMPULSE,
    })
    const striker = createDisc({ id: 1, side: 'player', x: 4.5 * CELL, y: 4.2 * CELL })
    const state = createState([stack, striker])
    striker.vy = -speedCells * CELL
    return state
  }

  test('only stacks carry a split threshold', () => {
    for (const id of FORMATION_ORDER) {
      const profile = BRANCH_PROFILES[id]
      for (const disc of buildFormation(id, METRICS, { piecesPerSide: PIECES })) {
        assert.equal(disc.kind, profile.kind, `${id}: kind`)
        assert.equal(disc.splitImpulse > 0, profile.kind === 'stack', `${id}: threshold should match kind`)
      }
    }
  })

  test('a hard hit breaks a stack into two discs of half the mass', () => {
    const state = headOn(18)
    const before = state.discs.length
    const outcome = runToRest(state, config())

    assert.equal(outcome.splits.length, 1, 'the stack should have come apart exactly once')
    assert.equal(state.discs.length, before + 1)

    const halves = state.discs.filter((d) => d.side === 'opponent')
    assert.equal(halves.length, 2)
    for (const half of halves) {
      assert.equal(half.kind, 'single', 'the halves are ordinary discs')
      assert.equal(half.splitImpulse, 0, 'and they never split again — §2 allows one level only')
      assert.ok(Math.abs(half.mass - BRANCH_PROFILES.artillery.mass / 2) < 1e-9)
      assert.ok(half.invMass > 0 && Math.abs(half.invMass - 1 / half.mass) < 1e-12, 'invMass must track mass')
    }
    assert.equal(new Set(state.discs.map((d) => d.id)).size, state.discs.length, 'the new disc needs a fresh id')
  })

  test('a gentle nudge leaves it standing', () => {
    const state = headOn(4)
    const outcome = runToRest(state, config())

    assert.ok(outcome.impacts.length > 0, 'they should still have touched')
    assert.equal(outcome.splits.length, 0, 'a nudge must not burst a stack')
    assert.equal(state.discs.filter((d) => d.side === 'opponent')[0].kind, 'stack')
  })

  test('the threshold is somewhere sensible between the two', () => {
    // Guards against a threshold so low everything shatters or so high nothing ever does — either
    // makes the mechanic invisible.
    let firstSplitting = null
    for (let speed = 4; speed <= 18; speed += 1) {
      if (runToRest(headOn(speed), config()).splits.length > 0) {
        firstSplitting = speed
        break
      }
    }
    assert.ok(firstSplitting !== null, 'no speed up to full power broke the stack')
    assert.ok(firstSplitting > 5 && firstSplitting < 16, `stacks start breaking at ${firstSplitting} cells/s, which is not a middling hit`)
  })

  test('splitting conserves momentum — a stack cannot fling its own halves apart', () => {
    // Its own setup, in the MIDDLE of a huge frictionless board. Three things would otherwise look
    // exactly like a conservation failure without being one: friction is a real external force,
    // `runToRest` freezes every disc when a frictionless board hits its 6-second ceiling, and a disc
    // knocked off the board takes its momentum with it — which is what a stack sitting three cells
    // from the edge does the instant it is hit.
    const stack = createDisc({
      id: 0,
      side: 'opponent',
      x: 50 * CELL,
      y: 50 * CELL,
      kind: 'stack',
      mass: BRANCH_PROFILES.artillery.mass,
      r: DISC_RADIUS * BRANCH_PROFILES.artillery.radiusScale,
      splitImpulse: STACK_SPLIT_IMPULSE,
    })
    const striker = createDisc({ id: 1, side: 'player', x: 50 * CELL, y: 51.2 * CELL })
    striker.vy = -18 * CELL
    const state = createState([stack, striker])

    const momentum = () => state.discs.filter((d) => d.alive).reduce((total, d) => total + d.mass * d.vy, 0)
    const before = momentum()

    const frictionless = config({ frictionDecel: 0, boardW: 100 * CELL, boardH: 100 * CELL })
    let split = false
    for (let i = 0; i < 400; i++) {
      const outcome = createOutcome()
      step(state, frictionless, outcome)
      if (outcome.splits.length > 0) split = true
    }

    assert.ok(split, 'expected the stack to break')
    assert.equal(state.discs.filter((d) => d.alive).length, 3, 'nothing should have left this board')
    const after = momentum()
    assert.ok(Math.abs(after - before) / Math.abs(before) < 1e-9, `momentum drifted from ${before} to ${after}`)
  })
})

describe('five rounds are playable', () => {
  /**
   * Plays a whole round with both sides taking a plain full-power shot at their nearest enemy.
   *
   * Deliberately not the bot: this is checking that every branch produces a round that STARTS,
   * progresses and ends, not that anyone plays it well. A naive driver is also a harsher test — it
   * loses discs off the board constantly, which is exactly the path a stalling bug would hide in.
   */
  function playRound(formation: (typeof FORMATION_ORDER)[number]) {
    const state = createState(buildFormation(formation, METRICS, { piecesPerSide: PIECES }))
    const round = createRound('player')
    const board = config()
    let shots = 0

    while (!round.winner && shots < 200) {
      const side = round.turn
      const mine = liveDiscs(state, side)
      const theirs = liveDiscs(state, opposite(side))
      if (mine.length === 0 || theirs.length === 0) break

      // Nearest enemy, straight at it, full power.
      const shooter = mine[shots % mine.length]
      let target = theirs[0]
      for (const enemy of theirs) {
        if (Math.hypot(enemy.x - shooter.x, enemy.y - shooter.y) < Math.hypot(target.x - shooter.x, target.y - shooter.y)) target = enemy
      }

      const angle = Math.atan2(target.y - shooter.y, target.x - shooter.x)
      const outcome = runToRest(state, board, { shot: { discId: shooter.id, angle, power: 1 } })
      assert.equal(outcome.timedOut, false, `${formation}: a shot never came to rest`)
      resolveShot(round, CLASSIC_RULES, state, METRICS, outcome)
      shots++
    }

    return { winner: round.winner, shots, discs: state.discs.length }
  }

  for (const formation of FORMATION_ORDER) {
    test(`${formation} plays to a finish`, () => {
      const result = playRound(formation)
      assert.ok(result.winner, `${formation} never produced a winner in ${result.shots} shots`)
      assert.ok(result.shots > 0)
    })
  }

  test('the campaign walks all five branches in order', () => {
    assert.equal(FORMATION_ORDER.length, 5)
    assert.equal(new Set(FORMATION_ORDER).size, 5)
    assert.equal(FORMATION_ORDER[0], 'infantry', 'the baseline the others are judged against comes first')
  })
})
