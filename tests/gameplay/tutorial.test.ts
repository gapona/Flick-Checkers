/**
 * Every lesson must be winnable, and none of them by accident.
 *
 * **This is the one defect a tutorial cannot ship with**, and no other check in this repository can
 * see it: `tsc` is happy with a lesson whose enemy is out of reach, the browser suite never fires a
 * shot, and reading the file tells you where the discs are and nothing about whether a disc can get
 * there. So this plays each lesson through the REAL solver — the same `runToRest` a match uses, with
 * the same config — over a fan of candidate shots, and asserts the goal is reachable.
 *
 * It also asserts the opposite, which matters more than it looks: a lesson that ANY shot solves is a
 * lesson that teaches nothing, and lesson three ({@link LESSON_KEEP}, "your own discs leave too") is
 * only a lesson at all if a lazy full-power pull straight back really does cost the player their
 * disc. That is checked directly rather than assumed.
 *
 * The search is a plain fan over angles and powers rather than `bot/search.ts`: the bot is tuned to
 * play WELL, and what is being asked here is whether a solution exists at all, which wants exhaustive
 * coverage of a small space rather than a good shortlist of a large one.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  HELP_CHAPTERS,
  judgeLesson,
  LESSONS,
  LESSON_IDS,
  lessonDiscs,
  readResult,
  type Lesson,
  type LessonResult,
} from '../../src/game/tutorial'
import { applyImpulse, runToRest } from '../../src/sim/shoot'
import { cloneState, createSimConfig, createState, liveDiscs, type SimState } from '../../src/sim/types'
import { METRICS } from './helpers'

const CONFIG = createSimConfig(METRICS)

/**
 * Angles per full turn, and powers per angle: 72 x 10 = 720 shots per shooting disc.
 *
 * Five degrees is a 0.44-cell lateral step at the range these lessons are played over, against discs
 * 0.8 cells wide — so a solution cannot slip between two samples. Finer was tried and is simply
 * slower: at 180 x 20 the whole file spends most of a minute in the solver, and this is a check that
 * belongs in `npm test` rather than in the slow tier.
 */
const ANGLE_STEPS = 72
const POWER_STEPS = 10

interface Attempt {
  angle: number
  power: number
  result: LessonResult
}

/** One shot, from one of the player's discs, on a fresh copy of the lesson. */
function fire(lesson: Lesson, discIndex: number, angle: number, power: number): LessonResult {
  const state: SimState = createState(lessonDiscs(lesson, METRICS))
  const shooters = liveDiscs(state, 'player')
  const shooter = shooters[discIndex]
  applyImpulse(shooter, angle, power, CONFIG.maxSpeed, CONFIG.powerCurve)
  const outcome = runToRest(state, CONFIG)
  return readResult(outcome, state)
}

/**
 * Every shot available from the opening position, from every one of the player's discs.
 *
 * Memoised per lesson: two tests ask the same question of the same sweep, and the sweep is the only
 * expensive thing in this file.
 */
const sweeps = new Map<string, Attempt[]>()

function sweep(lesson: Lesson): Attempt[] {
  const cached = sweeps.get(lesson.id)
  if (cached) return cached

  const attempts: Attempt[] = []
  const shooters = liveDiscs(createState(lessonDiscs(lesson, METRICS)), 'player').length

  for (let disc = 0; disc < shooters; disc++) {
    for (let a = 0; a < ANGLE_STEPS; a++) {
      const angle = (a / ANGLE_STEPS) * Math.PI * 2
      for (let p = 1; p <= POWER_STEPS; p++) {
        const power = p / POWER_STEPS
        attempts.push({ angle, power, result: fire(lesson, disc, angle, power) })
      }
    }
  }
  sweeps.set(lesson.id, attempts)
  return attempts
}

describe('tutorial lessons', () => {
  test('the id list and the lesson list agree', () => {
    assert.deepEqual(
      LESSONS.map((lesson) => lesson.id),
      [...LESSON_IDS],
    )
  })

  test('every lesson starts with discs on both sides, none of them overlapping', () => {
    for (const lesson of LESSONS) {
      const discs = lessonDiscs(lesson, METRICS)
      assert.ok(
        discs.some((disc) => disc.side === 'player'),
        `${lesson.id}: nothing to shoot with`,
      )
      assert.ok(
        discs.some((disc) => disc.side === 'opponent'),
        `${lesson.id}: nothing to shoot at`,
      )

      // Two discs placed closer than their radii start the round with the solver pushing them off
      // each other, which is a board that moves before anybody has touched it.
      for (let i = 0; i < discs.length; i++) {
        for (let j = i + 1; j < discs.length; j++) {
          const gap = Math.hypot(discs[i].x - discs[j].x, discs[i].y - discs[j].y)
          assert.ok(gap >= discs[i].r + discs[j].r, `${lesson.id}: discs ${i} and ${j} overlap at rest (${gap.toFixed(1)})`)
        }
      }

      // Nothing may start off the board, or in a position the very first step removes.
      for (const disc of discs) {
        assert.ok(disc.x > 0 && disc.x < METRICS.boardW, `${lesson.id}: a disc starts off the board horizontally`)
        assert.ok(disc.y > 0 && disc.y < METRICS.boardH, `${lesson.id}: a disc starts off the board vertically`)
      }
    }
  })

  // The five one-shot lessons. `clear` needs several shots by construction and is checked below.
  for (const lesson of LESSONS.filter((one) => one.maxShots === 1)) {
    test(`${lesson.id} is solvable in one shot`, () => {
      const solutions = sweep(lesson).filter((attempt) => judgeLesson(lesson, attempt.result, 1) === 'passed')
      assert.ok(solutions.length > 0, `${lesson.id}: no shot in the sweep meets the goal`)
    })

    test(`${lesson.id} is not solved by every shot`, () => {
      const attempts = sweep(lesson)
      const solved = attempts.filter((attempt) => judgeLesson(lesson, attempt.result, 1) === 'passed').length
      // A lesson anything solves teaches nothing. The ceiling is generous — this is a guard against
      // a degenerate position, not a difficulty measurement.
      assert.ok(solved / attempts.length < 0.5, `${lesson.id}: ${((solved / attempts.length) * 100).toFixed(0)}% of all shots solve it`)
    })
  }

  test('clear can be won, and running out of discs loses it', () => {
    const lesson = LESSONS.find((one) => one.id === 'clear')
    assert.ok(lesson)

    // Winnable: play greedily — best shot available each turn, several shots deep — and require the
    // board to come clean. This is the lesson's own promise, and it is the only one that needs more
    // than one shot to keep.
    const state = createState(lessonDiscs(lesson, METRICS))
    let shots = 0
    while (liveDiscs(state, 'opponent').length > 0 && shots < 12) {
      let best: { disc: number; angle: number; power: number; removed: number } | null = null

      for (let disc = 0; disc < liveDiscs(state, 'player').length; disc++) {
        for (let a = 0; a < ANGLE_STEPS; a++) {
          const angle = (a / ANGLE_STEPS) * Math.PI * 2
          for (let p = 1; p <= POWER_STEPS; p++) {
            const power = p / POWER_STEPS
            // `cloneState` preserves disc order, so the same index selects the same disc on the
            // trial and on the real board — which is what makes the chosen shot replayable below.
            const trial = cloneState(state)
            applyImpulse(liveDiscs(trial, 'player')[disc], angle, power, CONFIG.maxSpeed, CONFIG.powerCurve)
            const result = readResult(runToRest(trial, CONFIG), trial)
            // Never at the cost of one of our own: two discs against three cannot afford a trade.
            if (result.ownOff > 0) continue
            if (!best || result.enemyOff > best.removed) best = { disc, angle, power, removed: result.enemyOff }
          }
        }
      }

      assert.ok(best && best.removed > 0, `no progress available after ${shots} shots`)
      applyImpulse(liveDiscs(state, 'player')[best.disc], best.angle, best.power, CONFIG.maxSpeed, CONFIG.powerCurve)
      runToRest(state, CONFIG)
      shots++
    }
    assert.equal(liveDiscs(state, 'opponent').length, 0, 'the board could not be cleared in twelve shots')

    // And losing: an empty side is a failure however many shots are left.
    assert.equal(judgeLesson(lesson, { enemyOff: 0, ownOff: 2, enemiesLeft: 3, ownLeft: 0 }, 1), 'failed')
    // While anything short of that just carries on — the whole point of `maxShots: 0`.
    assert.equal(judgeLesson(lesson, { enemyOff: 1, ownOff: 0, enemiesLeft: 2, ownLeft: 2 }, 1), 'again')
  })

  test('the lesson about losing your own disc can actually be failed that way', () => {
    const lesson = LESSONS.find((one) => one.id === 'keep')
    assert.ok(lesson)

    // Straight up the board at full power — the lazy answer the lesson is written against. The enemy
    // is off this axis, so the shot must miss and run off the far edge.
    const straightUp = -Math.PI / 2
    const result = fire(lesson, 0, straightUp, 1)
    assert.equal(result.enemyOff, 0, 'the lazy shot was supposed to miss')
    assert.equal(result.ownOff, 1, 'a full-power miss from the near rank must cost the shooter its disc')
    assert.equal(judgeLesson(lesson, result, 1), 'failed')
  })

  test('a shot that takes the enemy but loses a disc still fails a keepOwn lesson', () => {
    for (const lesson of LESSONS.filter((one) => one.goal.keepOwn)) {
      assert.equal(judgeLesson(lesson, { enemyOff: 1, ownOff: 1, enemiesLeft: 0, ownLeft: 0 }, 1), 'failed', lesson.id)
      assert.equal(judgeLesson(lesson, { enemyOff: 1, ownOff: 0, enemiesLeft: 0, ownLeft: 1 }, 1), 'passed', lesson.id)
    }
  })

  test('the combo lesson is not satisfied by one disc', () => {
    const lesson = LESSONS.find((one) => one.id === 'combo')
    assert.ok(lesson)
    assert.equal(judgeLesson(lesson, { enemyOff: 1, ownOff: 0, enemiesLeft: 2, ownLeft: 1 }, 1), 'failed')
    assert.equal(judgeLesson(lesson, { enemyOff: 2, ownOff: 0, enemiesLeft: 1, ownLeft: 1 }, 1), 'passed')
  })
})

describe('how to play', () => {
  test('every chapter has a heading and at least one paragraph', () => {
    assert.ok(HELP_CHAPTERS.length > 0)
    for (const chapter of HELP_CHAPTERS) {
      assert.ok(chapter.titleKey.length > 0)
      assert.ok(chapter.bodyKeys.length > 0, `${chapter.titleKey} has no copy`)
    }
  })

  test('no chapter heading or paragraph key appears twice', () => {
    const keys = HELP_CHAPTERS.flatMap((chapter) => [chapter.titleKey, ...chapter.bodyKeys])
    assert.equal(new Set(keys).size, keys.length, 'a key is rendered in two places')
  })

  test('the two data-driven chapters are the ones that name a source', () => {
    const sourced = HELP_CHAPTERS.filter((chapter) => chapter.source !== undefined).map((chapter) => chapter.source)
    // The rule sets and the branches of arms are read from the game's own data rather than restated
    // here — see `scenes/HowToPlay.ts`. A third source would need a branch in that scene.
    assert.deepEqual(sourced, ['rules', 'branches'])
  })
})
