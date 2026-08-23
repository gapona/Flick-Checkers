/**
 * The turn matrix of GAME-PLAN.md §3 — S6's definition of done, which asks for a scenario per
 * flag of `RuleSet`.
 *
 * Organised by flag rather than by function, because that is the thing being specified: each block
 * below is one rule, on and off, plus whatever it collides with.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { BLITZ_RULES, CLASSIC_RULES, type RuleSet } from '../../src/game/rules'
import { createRound, forfeitShot, isOnHomeRank, resolveShot, summarise, PENALTY_SHOTS } from '../../src/game/round'
import { infantryFormation } from '../../src/game/formations'
import { runToRest } from '../../src/sim/shoot'
import { liveDiscs } from '../../src/sim/types'
import { at, board, config, METRICS, shotOutcome } from './helpers'

/** A board with discs on both sides, so nobody wins by accident while a flag is being tested. */
function contested() {
  return board(at(0, 'player', 3, 7), at(1, 'player', 4, 7), at(2, 'opponent', 3, 0), at(3, 'opponent', 4, 0))
}

function rules(overrides: Partial<RuleSet>): RuleSet {
  return { ...CLASSIC_RULES, ...overrides }
}

/** One shot by the side to move, with a fabricated result. */
function shoot(round: ReturnType<typeof createRound>, set: RuleSet, state = contested(), fake = {}) {
  return resolveShot(round, set, state, METRICS, shotOutcome({ shooter: round.turn, ...fake }))
}

describe('extraShotOnKnockout', () => {
  test('on: knocking an enemy off keeps the turn', () => {
    // §3 calls this the most valuable addition to the original: it is what turns one lucky hit into
    // a run, and the run is what keeps a session going past three minutes.
    const set = rules({ extraShotOnKnockout: true, ownOffIsPenalty: false })
    const round = createRound('player')

    const result = shoot(round, set, contested(), { enemyOff: 1 })

    assert.equal(result.reason, 'extraShot')
    assert.equal(round.turn, 'player')
    assert.ok(round.shotsLeft >= 1)
  })

  test('off: the turn always passes, exactly as in the board game', () => {
    const round = createRound('player')
    const result = shoot(round, CLASSIC_RULES, contested(), { enemyOff: 1 })

    assert.equal(result.reason, 'pass')
    assert.equal(round.turn, 'opponent')
    assert.equal(round.shotsLeft, 1)
  })

  test('a shot that touches an enemy without removing it does not earn another', () => {
    const set = rules({ extraShotOnKnockout: true })
    const round = createRound('player')

    const result = shoot(round, set, contested(), { enemyOff: 0, touchedEnemy: true })

    assert.equal(result.reason, 'pass')
    assert.equal(round.turn, 'opponent')
  })
})

describe('ownOffIsPenalty', () => {
  test('on: losing your own disc hands the opponent two shots', () => {
    const set = rules({ ownOffIsPenalty: true })
    const round = createRound('player')

    const result = shoot(round, set, contested(), { ownOff: 1, touchedEnemy: true })

    assert.equal(result.reason, 'penalty')
    assert.equal(round.turn, 'opponent')
    assert.equal(round.shotsLeft, PENALTY_SHOTS)
  })

  test('off: losing your own disc is just a bad shot', () => {
    const set = rules({ ownOffIsPenalty: false, mustTouchEnemy: false })
    const round = createRound('player')

    const result = shoot(round, set, contested(), { ownOff: 1, touchedEnemy: true })

    assert.equal(result.reason, 'pass')
    assert.equal(round.shotsLeft, 1)
  })

  test('the penalty beats an extra shot on the same shot', () => {
    // Precedence 1 in `round.ts`'s header. Rewarding a shot that cost you a disc with another go
    // makes the penalty toothless exactly when it should bite.
    const set = rules({ ownOffIsPenalty: true, extraShotOnKnockout: true })
    const round = createRound('player')

    const result = shoot(round, set, contested(), { enemyOff: 1, ownOff: 1 })

    assert.equal(result.reason, 'penalty')
    assert.equal(round.turn, 'opponent')
    assert.equal(round.shotsLeft, PENALTY_SHOTS)
  })
})

describe('mustTouchEnemy', () => {
  test('on: a shot that touches nothing is penalised', () => {
    const set = rules({ mustTouchEnemy: true })
    const round = createRound('player')

    const result = shoot(round, set, contested(), { touchedEnemy: false })

    assert.equal(result.reason, 'penalty')
    assert.equal(round.turn, 'opponent')
    assert.equal(round.shotsLeft, PENALTY_SHOTS)
  })

  test('off: a shot into empty space merely wastes the turn — the shipped default', () => {
    // A beginner's shot through a gap has already achieved nothing; punishing it twice is how a new
    // player concludes the game dislikes them.
    const round = createRound('player')
    const result = shoot(round, CLASSIC_RULES, contested(), { touchedEnemy: false })

    assert.equal(result.reason, 'pass')
    assert.equal(round.shotsLeft, 1)
  })

  test('a bank off your own disc into an enemy still counts as touching one', () => {
    // The skilful version of the same move must not be the punished one. `touchedEnemy` is set by
    // the solver for any contact involving an enemy, however the shot got there.
    const set = rules({ mustTouchEnemy: true })
    const round = createRound('player')

    const result = shoot(round, set, contested(), { touchedEnemy: true })

    assert.equal(result.reason, 'pass')
    assert.notEqual(result.reason, 'penalty')
  })

  test('two penalties on one shot are still one penalty', () => {
    // Precedence 2: four shots for the opponent is a spiral a beginner cannot climb out of.
    const set = rules({ mustTouchEnemy: true, ownOffIsPenalty: true })
    const round = createRound('player')

    shoot(round, set, contested(), { ownOff: 1, touchedEnemy: false })

    assert.equal(round.shotsLeft, PENALTY_SHOTS)
  })
})

describe('awarded shots are spent one at a time', () => {
  test('two shots means two shots, then the turn passes', () => {
    const set = rules({ ownOffIsPenalty: true, mustTouchEnemy: false, extraShotOnKnockout: false })
    const round = createRound('player')

    shoot(round, set, contested(), { ownOff: 1, touchedEnemy: true })
    assert.equal(round.turn, 'opponent')
    assert.equal(round.shotsLeft, 2)

    const second = shoot(round, set, contested(), { touchedEnemy: true })
    assert.equal(second.reason, 'sameTurn')
    assert.equal(round.turn, 'opponent')
    assert.equal(round.shotsLeft, 1)

    const third = shoot(round, set, contested(), { touchedEnemy: true })
    assert.equal(third.reason, 'pass')
    assert.equal(round.turn, 'player')
  })

  test('a shot from the side that is not to move changes nothing', () => {
    // Always a caller bug; accepting it quietly would let a UI race hand one side two turns.
    const round = createRound('player')
    const before = { ...round }

    const result = resolveShot(round, CLASSIC_RULES, contested(), METRICS, shotOutcome({ shooter: 'opponent', enemyOff: 1 }))

    assert.equal(round.turn, before.turn)
    assert.equal(round.shots, before.shots)
    assert.equal(result.knockouts, 0)
  })
})

describe('winning the round', () => {
  test('clearing the opponent wins', () => {
    const set = CLASSIC_RULES
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'opponent', 3, 0))
    state.discs[1].alive = false

    const result = resolveShot(round, set, state, METRICS, shotOutcome({ shooter: 'player', enemyOff: 1 }))

    assert.equal(result.reason, 'roundOver')
    assert.equal(round.winner, 'player')
    assert.equal(round.shotsLeft, 0)
  })

  test('knocking your own last disc off loses, even while clearing the opponent', () => {
    // Precedence 3: someone has to lose a mutual wipe-out, and it should be whoever caused it.
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'opponent', 3, 0))
    state.discs[0].alive = false
    state.discs[1].alive = false

    resolveShot(round, CLASSIC_RULES, state, METRICS, shotOutcome({ shooter: 'player', enemyOff: 1, ownOff: 1 }))

    assert.equal(round.winner, 'opponent')
  })

  test('once the round is over nothing else moves it', () => {
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'opponent', 3, 0))
    state.discs[1].alive = false
    resolveShot(round, CLASSIC_RULES, state, METRICS, shotOutcome({ shooter: 'player', enemyOff: 1 }))

    const after = resolveShot(round, CLASSIC_RULES, state, METRICS, shotOutcome({ shooter: 'player', enemyOff: 1 }))
    assert.equal(after.reason, 'roundOver')
    assert.equal(round.winner, 'player')
    assert.equal(forfeitShot(round).reason, 'roundOver')
  })
})

describe('lastHopeStrike', () => {
  test('a side down to one disc on its own back rank shoots first next round', () => {
    const set = rules({ lastHopeStrike: true })
    const round = createRound('player')
    // The player is reduced to a single disc, still on row 7 — its home rank.
    const state = board(at(0, 'player', 3, 7), at(1, 'opponent', 3, 0), at(2, 'opponent', 4, 0))

    resolveShot(round, set, state, METRICS, shotOutcome({ shooter: 'player', touchedEnemy: true }))
    assert.equal(round.lastHope, 'player')

    // Now the player loses that last disc and the round with it.
    state.discs[0].alive = false
    resolveShot(round, set, state, METRICS, shotOutcome({ shooter: 'opponent', enemyOff: 1 }))

    const summary = summarise(round, set)
    assert.equal(summary?.winner, 'opponent')
    assert.equal(summary?.firstNextRound, 'player', 'the comeback rule is the whole point of the flag')
  })

  test('a side that was down to one disc and CAME BACK does not also get the opening shot', () => {
    // The direction of the handicap, and it used to point the wrong way. `lastHope` is sticky, so a
    // side that was pinned to its back rank keeps the flag even after it wins the round — and the
    // rule then handed the round's WINNER the next round's opening shot. `verify:balance` measured
    // that at 11.5% of rounds against a first-shooter round win rate of 71.8%: a comeback rule
    // amplifying the lead instead of braking it.
    const set = rules({ lastHopeStrike: true })
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'opponent', 3, 0), at(2, 'opponent', 4, 0))

    resolveShot(round, set, state, METRICS, shotOutcome({ shooter: 'player', touchedEnemy: true }))
    assert.equal(round.lastHope, 'player', 'the player is the pinned side')

    // The turn passes — strict alternation — and the opponent achieves nothing with it.
    resolveShot(round, set, state, METRICS, shotOutcome({ shooter: 'opponent' }))
    assert.equal(round.turn, 'player')

    // ...and then the player clears the board instead of losing it.
    state.discs[1].alive = false
    state.discs[2].alive = false
    resolveShot(round, set, state, METRICS, shotOutcome({ shooter: 'player', enemyOff: 2 }))

    const summary = summarise(round, set)
    assert.equal(summary?.winner, 'player')
    assert.equal(summary?.firstNextRound, 'opponent', 'the loser opens, not the winner who happens to still carry the flag')
  })

  test('off: the loser opens the next round instead', () => {
    const set = rules({ lastHopeStrike: false })
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'opponent', 3, 0), at(2, 'opponent', 4, 0))

    resolveShot(round, set, state, METRICS, shotOutcome({ shooter: 'player', touchedEnemy: true }))
    state.discs[0].alive = false
    resolveShot(round, set, state, METRICS, shotOutcome({ shooter: 'opponent', enemyOff: 1 }))

    assert.equal(summarise(round, set)?.firstNextRound, 'player', 'still the loser, but by courtesy rather than by the rule')
  })

  test('one disc away from the back rank does not earn it', () => {
    const set = rules({ lastHopeStrike: true })
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 4), at(1, 'opponent', 3, 0), at(2, 'opponent', 4, 0))

    resolveShot(round, set, state, METRICS, shotOutcome({ shooter: 'player', touchedEnemy: true }))
    assert.equal(round.lastHope, null)
  })

  test('isOnHomeRank reads each side from its own end of the board', () => {
    assert.equal(isOnHomeRank(at(0, 'player', 3, 7), 'player', METRICS), true)
    assert.equal(isOnHomeRank(at(0, 'player', 3, 0), 'player', METRICS), false)
    assert.equal(isOnHomeRank(at(0, 'opponent', 3, 0), 'opponent', METRICS), true)
    assert.equal(isOnHomeRank(at(0, 'opponent', 3, 7), 'opponent', METRICS), false)
  })
})

describe('advanceOnCleanWin', () => {
  test('winning without losing a disc is reported as a clean win', () => {
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'opponent', 3, 0))
    state.discs[1].alive = false

    resolveShot(round, CLASSIC_RULES, state, METRICS, shotOutcome({ shooter: 'player', enemyOff: 1 }))

    assert.equal(summarise(round, CLASSIC_RULES)?.cleanWin, true)
  })

  test('having lost one along the way is not', () => {
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'player', 4, 7), at(2, 'opponent', 3, 0))

    // The player loses one of its own first.
    resolveShot(round, { ...CLASSIC_RULES, ownOffIsPenalty: false }, state, METRICS, shotOutcome({ shooter: 'player', ownOff: 1, touchedEnemy: true }))
    state.discs[2].alive = false
    resolveShot(round, { ...CLASSIC_RULES, ownOffIsPenalty: false }, state, METRICS, shotOutcome({ shooter: 'opponent', ownOff: 1 }))

    const summary = summarise(round, CLASSIC_RULES)
    assert.equal(summary?.winner, 'player')
    assert.equal(summary?.cleanWin, false)
  })

  test('summarise reports nothing while the round is still running', () => {
    assert.equal(summarise(createRound('player'), CLASSIC_RULES), null)
  })
})

describe('shotClockMs', () => {
  test('running out of time passes the turn without a penalty', () => {
    // §5 offers the timer as a tempo device, not a punishment: charging two shots on top would make
    // a mode meant to feel fast feel unfair.
    const round = createRound('player')
    const result = forfeitShot(round)

    assert.equal(result.reason, 'pass')
    assert.equal(round.turn, 'opponent')
    assert.equal(round.shotsLeft, 1)
  })

  test('a forfeit gives up the whole turn, not one shot of an award', () => {
    const set = rules({ ownOffIsPenalty: true })
    const round = createRound('player')
    shoot(round, set, contested(), { ownOff: 1, touchedEnemy: true })
    assert.equal(round.shotsLeft, PENALTY_SHOTS)

    forfeitShot(round)
    assert.equal(round.turn, 'player', 'the side that let the clock run out keeps none of its award')
    assert.equal(round.shotsLeft, 1)
  })

  test('the core set has no clock at all — only blitz does', () => {
    assert.equal(CLASSIC_RULES.shotClockMs, 0)
    assert.equal(BLITZ_RULES.shotClockMs, 5000)
  })
})

describe('bumperRim and piecesPerSide', () => {
  test('bumperRim: a shot that would leave the board bounces instead, so nobody is knocked out', () => {
    // The one flag that is a physics question rather than a bookkeeping one, so it is checked
    // through the real solver.
    const state = board(at(0, 'player', 4, 6))
    const outcome = runToRest(state, config({ bumperRim: true }), { shot: { discId: 0, angle: -Math.PI / 2, power: 1 } })

    assert.equal(outcome.knockedOff.length, 0)
    assert.equal(liveDiscs(state, 'player').length, 1)
  })

  test('without bumpers the same shot loses the disc, and the round with it', () => {
    const state = board(at(0, 'player', 4, 6), at(1, 'opponent', 0, 0))
    const round = createRound('player')
    const outcome = runToRest(state, config(), { shot: { discId: 0, angle: -Math.PI / 2, power: 1 } })

    assert.equal(outcome.knockedOff.length, 1)
    resolveShot(round, CLASSIC_RULES, state, METRICS, outcome)
    assert.equal(round.winner, 'opponent', 'the player shot its only disc off the board')
  })

  test('piecesPerSide builds that many discs a side, centred on the rank', () => {
    for (const count of [4, 6, 8]) {
      const discs = infantryFormation(METRICS, { piecesPerSide: count })
      assert.equal(discs.filter((d) => d.side === 'player').length, count)
      assert.equal(discs.filter((d) => d.side === 'opponent').length, count)
    }
  })
})

describe('end to end, through the real solver', () => {
  test('a full-power shot up the column takes the enemy disc — and the turn still passes', () => {
    // The shipped default alternates strictly: no set turns `extraShotOnKnockout` on any more, and
    // the reason is measured rather than asserted — `npm run verify:balance`, GAME-PLAN.md §3.
    // What this covers is that a knockout is really a knockout end to end, through the real solver.
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'player', 5, 7), at(2, 'opponent', 3, 0), at(3, 'opponent', 6, 0))

    const outcome = runToRest(state, config(), { shot: { discId: 0, angle: -Math.PI / 2, power: 1 } })
    const result = resolveShot(round, CLASSIC_RULES, state, METRICS, outcome)

    assert.equal(outcome.touchedEnemy, true)
    assert.equal(result.knockouts, 1, 'the enemy disc should have been driven off the top edge')
    assert.equal(result.reason, 'pass')
    assert.equal(round.turn, 'opponent')
  })

  test('the flag still works end to end for the arcade mode that will want it', () => {
    // `extraShotOnKnockout` ships off in every rule set but stays in `RuleSet`. A flag nothing
    // switches on is a flag that quietly stops working, so the real solver drives it here too.
    const set = { ...CLASSIC_RULES, extraShotOnKnockout: true }
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'player', 5, 7), at(2, 'opponent', 3, 0), at(3, 'opponent', 6, 0))

    const outcome = runToRest(state, config(), { shot: { discId: 0, angle: -Math.PI / 2, power: 1 } })
    const result = resolveShot(round, set, state, METRICS, outcome)

    assert.equal(result.knockouts, 1)
    assert.equal(result.reason, 'extraShot')
    assert.equal(round.turn, 'player')
  })

  test("the same shot under the board game's own two demands still passes the turn", () => {
    // `mustTouchEnemy` and `advanceOnCleanWin` are the two flags the shipped set leaves OFF (see
    // `CLASSIC_RULES`). Nothing ships with them on, so they are driven here through the real solver:
    // a flag nothing switches on is a flag that quietly stops working, and these two are the pair a
    // future calibration pass is most likely to switch back.
    const set = rules({ mustTouchEnemy: true, advanceOnCleanWin: true })
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'player', 5, 7), at(2, 'opponent', 3, 0), at(3, 'opponent', 6, 0))

    const outcome = runToRest(state, config(), { shot: { discId: 0, angle: -Math.PI / 2, power: 1 } })
    const result = resolveShot(round, set, state, METRICS, outcome)

    assert.equal(result.knockouts, 1)
    assert.equal(result.reason, 'pass')
    assert.equal(round.turn, 'opponent')
  })

  test('a round played to the end produces a winner and a summary', () => {
    const set = CLASSIC_RULES
    const round = createRound('player')
    const state = board(at(0, 'player', 3, 7), at(1, 'opponent', 3, 0))

    // One shot straight up the column: it removes the only enemy disc and ends the round.
    const outcome = runToRest(state, config(), { shot: { discId: 0, angle: -Math.PI / 2, power: 1 } })
    resolveShot(round, set, state, METRICS, outcome)

    const summary = summarise(round, set)
    assert.equal(round.winner, 'player')
    assert.equal(summary?.shots, 1)
    assert.ok(summary?.cleanWin !== undefined)
  })
})

/**
 * The numbers the result panel shows (chunk 10 of `PROMPT-UI.md`).
 *
 * They live on the round rather than being tallied by the scene for one reason, and it is the reason
 * worth testing: a round can be saved and resumed, and a counter kept in `Game` would silently reset
 * to zero and under-report the player's own round back to them.
 */
describe('round tallies', () => {
  test('knockouts accumulate per side, combos keep the largest single shot', () => {
    const set = rules({ extraShotOnKnockout: true, ownOffIsPenalty: false })
    const round = createRound('player')

    shoot(round, set, contested(), { enemyOff: 2 })
    shoot(round, set, contested(), { enemyOff: 1 })

    assert.equal(round.knockedOut.player, 3, 'both shots count toward the total')
    assert.equal(round.bestCombo.player, 2, 'the best combo is the largest shot, not the last one')
    assert.equal(round.knockedOut.opponent, 0, 'the other side is untouched by the shooter’s tally')
    assert.equal(round.bestCombo.opponent, 0)
  })

  test('the shot that ENDS the round is still counted', () => {
    // It returns early on a win, so a tally placed after the victory test would drop exactly the
    // shot most worth reporting — the one the panel is about to open on.
    const set = rules({ extraShotOnKnockout: false })
    const round = createRound('player')
    // The victory test reads the BOARD, not the outcome, so the disc has to actually be off it.
    const dead = at(1, 'opponent', 3, 0)
    dead.alive = false
    const state = board(at(0, 'player', 3, 7), dead)

    const result = shoot(round, set, state, { enemyOff: 1 })

    assert.equal(result.winner, 'player')
    assert.equal(round.knockedOut.player, 1)
    assert.equal(round.bestCombo.player, 1)
  })

  test('summarise carries them out, and a copy rather than the live object', () => {
    const set = rules({ extraShotOnKnockout: false })
    const round = createRound('player')
    const dead = at(1, 'opponent', 3, 0)
    dead.alive = false
    const state = board(at(0, 'player', 3, 7), dead)
    shoot(round, set, state, { enemyOff: 1 })

    const summary = summarise(round, set)
    assert.ok(summary)
    assert.equal(summary.knockedOut.player, 1)
    assert.equal(summary.bestCombo.player, 1)

    round.knockedOut.player = 99
    assert.equal(summary.knockedOut.player, 1, 'the summary must not alias the live round')
  })
})
