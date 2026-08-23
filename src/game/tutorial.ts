/**
 * The tutorial, as data: six lessons and the reference chapters.
 *
 * **Phaser-free, like `game/rules.ts` and `game/formations.ts`** — a lesson is a board position, a
 * goal and three lines of copy, and none of that needs a renderer. `tests/gameplay/tutorial.test.ts`
 * therefore plays every lesson through the REAL solver under plain node and asserts each one is
 * winnable at all, which is the only property of a lesson that cannot be checked by reading it.
 *
 * ## Why the lessons are one shot each
 *
 * A lesson that lets you keep firing until something works teaches persistence, not aim. Every
 * lesson but the last resolves on ONE shot: the goal is met, or the board is put back and the hint
 * is shown. That makes each lesson a question with an answer rather than a sandbox, and it makes the
 * failure the teaching moment — {@link LESSON_KEEP} is a lesson you learn by losing a disc.
 *
 * ## What is taught here and what is not
 *
 * Only what a board can show: the gesture, the reach, the line stopping at the first contact, the
 * cost of losing your own disc, the combo, and clearing a side. Everything else about the game — the
 * modes, the branches of arms, the economy, the ladder, the daily — is READING rather than doing,
 * and lives in {@link HELP_CHAPTERS}, which `scenes/HowToPlay.ts` renders. Teaching the shop by
 * making somebody play it would be worse than a paragraph, not better.
 */
import { gridToScreen, type BoardMetrics } from '../board/layout'
import { createDisc, liveDiscs, type Disc, type SimState, type Side } from '../sim/types'
import { knockedOffOf, type SimOutcome } from '../sim/outcome'
import type { StringKey } from '../i18n/strings'

export const LESSON_IDS = ['flick', 'reach', 'keep', 'around', 'combo', 'clear'] as const
export type LessonId = (typeof LESSON_IDS)[number]

/**
 * Where a lesson's disc starts, in CELLS of an 8x8 board — fractions allowed, because a lesson
 * places discs where the point is rather than where a formation would. Row 0 is the far (opponent)
 * edge and row 7 the near one, matching `game/formations.ts`' own mirroring.
 */
export interface LessonPlacement {
  side: Side
  col: number
  row: number
}

/**
 * What a lesson asks for.
 *
 * Declarative rather than a predicate function, so the test can enumerate the goals and the scene
 * can describe them — a closure would be neither readable from outside nor printable.
 */
export interface LessonGoal {
  /** Enemy discs this one shot must drive off. */
  knockouts?: number
  /** Every enemy disc must be gone, however many shots that takes. */
  clearAll?: boolean
  /** And it must not have cost one of the player's own. */
  keepOwn?: boolean
}

export interface Lesson {
  id: LessonId
  titleKey: StringKey
  /** What to do, shown before the shot. */
  briefKey: StringKey
  /** Shown after a shot that missed the goal — the rule that the failure has just demonstrated. */
  hintKey: StringKey
  /** Shown once it is met. */
  doneKey: StringKey
  goal: LessonGoal
  /** Shots before the board is put back. `0` is unlimited — see {@link LESSON_CLEAR}. */
  maxShots: number
  discs: readonly LessonPlacement[]
}

/**
 * 1. The gesture.
 *
 * Deliberately the shortest shot in the tutorial: the enemy sits a cell and a half from the far edge
 * with the shooter four cells behind it, so the whole thing needs under half of full power and a
 * tentative first pull still works. Nothing here is a test of aim — the only thing being asked is
 * whether the player has understood that the disc goes AWAY from the finger.
 */
const LESSON_FLICK: Lesson = {
  id: 'flick',
  titleKey: 'tutFlickTitle',
  briefKey: 'tutFlickBrief',
  hintKey: 'tutFlickHint',
  doneKey: 'tutFlickDone',
  goal: { knockouts: 1 },
  maxShots: 1,
  discs: [
    { side: 'player', col: 3, row: 5 },
    { side: 'opponent', col: 3, row: 1 },
  ],
}

/**
 * 2. How far a pull carries.
 *
 * Across the diagonal, so it cannot be answered by pulling straight back — and long enough that it
 * needs most of the drag. Measured against `sim/types.ts`' own constants: about 9.2 cells of travel
 * out of a full reach of 11.6, which under `POWER_CURVE` is a pull of roughly 0.83.
 */
const LESSON_REACH: Lesson = {
  id: 'reach',
  titleKey: 'tutReachTitle',
  briefKey: 'tutReachBrief',
  hintKey: 'tutReachHint',
  doneKey: 'tutReachDone',
  goal: { knockouts: 1 },
  maxShots: 1,
  discs: [
    { side: 'player', col: 1, row: 7 },
    { side: 'opponent', col: 6, row: 0 },
  ],
}

/**
 * 3. Your own disc is lost the same way.
 *
 * The enemy is deliberately OFF the shooter's axis, so the lazy answer — pull straight back as hard
 * as it goes — misses, and a full-power miss from the near rank runs clean off the far edge. The
 * failure IS the lesson, which is why this one comes before anything harder: it is the rule the
 * whole game is built on, and the cheapest place to learn it is a board with two discs on it.
 */
const LESSON_KEEP: Lesson = {
  id: 'keep',
  titleKey: 'tutKeepTitle',
  briefKey: 'tutKeepBrief',
  hintKey: 'tutKeepHint',
  doneKey: 'tutKeepDone',
  goal: { knockouts: 1, keepOwn: true },
  maxShots: 1,
  discs: [
    { side: 'player', col: 3, row: 6 },
    { side: 'opponent', col: 5, row: 1 },
  ],
}

/**
 * 4. The aim line stops at the first thing the shot meets.
 *
 * One of the player's own discs sits two cells directly in front of the shooter. Both answers are
 * the physical board game and both are accepted: go round it, or bank off it. The blocker is placed so that the
 * straight line to the enemy clears it by 1.03 cells against the 0.8 two discs touch at — enough to
 * be findable, close enough that the preview is worth reading rather than obvious.
 */
const LESSON_AROUND: Lesson = {
  id: 'around',
  titleKey: 'tutAroundTitle',
  briefKey: 'tutAroundBrief',
  hintKey: 'tutAroundHint',
  doneKey: 'tutAroundDone',
  goal: { knockouts: 1, keepOwn: true },
  maxShots: 1,
  discs: [
    { side: 'player', col: 3, row: 6 },
    { side: 'player', col: 3, row: 4 },
    { side: 'opponent', col: 6, row: 1 },
  ],
}

/**
 * 5. Two in one shot.
 *
 * A triangle of three, loosely packed near the far edge — the same shape `daily/puzzle.ts` generates,
 * for the same reason: three discs strewn over open board cannot be cleared by one shot at all,
 * while a cluster within reach of an edge makes it a matter of finding the line. Kept 0.85 to 1.1
 * cells apart, comfortably over the 0.8 two discs touch at, so the opening position does not start
 * with the solver pushing them off each other.
 */
const LESSON_COMBO: Lesson = {
  id: 'combo',
  titleKey: 'tutComboTitle',
  briefKey: 'tutComboBrief',
  hintKey: 'tutComboHint',
  doneKey: 'tutComboDone',
  goal: { knockouts: 2 },
  maxShots: 1,
  discs: [
    { side: 'player', col: 3, row: 6 },
    { side: 'opponent', col: 2.45, row: 0.8 },
    { side: 'opponent', col: 3.55, row: 0.8 },
    { side: 'opponent', col: 3, row: 0.1 },
  ],
}

/**
 * 6. A round, in miniature.
 *
 * The only lesson with more than one shot, because it is the only one that is not about a single
 * shot: clearing a side is what a round IS. Two discs against three, unlimited shots, and the board
 * is put back only if the player runs out of their own — which is also the round's real losing
 * condition, met here for the first time.
 */
const LESSON_CLEAR: Lesson = {
  id: 'clear',
  titleKey: 'tutClearTitle',
  briefKey: 'tutClearBrief',
  hintKey: 'tutClearHint',
  doneKey: 'tutClearDone',
  goal: { clearAll: true },
  maxShots: 0,
  discs: [
    { side: 'player', col: 3, row: 6 },
    { side: 'player', col: 4, row: 6 },
    { side: 'opponent', col: 2, row: 1 },
    { side: 'opponent', col: 4, row: 1 },
    { side: 'opponent', col: 6, row: 1 },
  ],
}

export const LESSONS: readonly Lesson[] = [LESSON_FLICK, LESSON_REACH, LESSON_KEEP, LESSON_AROUND, LESSON_COMBO, LESSON_CLEAR]

/**
 * The discs a lesson starts with, ready for `createState()`.
 *
 * Ids are assigned here and are stable for the attempt, exactly as `buildFormation` does it and for
 * the same reason — they fix the solver's traversal order, which is half of its determinism.
 */
export function lessonDiscs(lesson: Lesson, metrics: BoardMetrics): Disc[] {
  return lesson.discs.map((placement, id) => {
    const at = gridToScreen(metrics, placement.col, placement.row)
    return createDisc({ id, side: placement.side, x: at.x, y: at.y })
  })
}

/** What one settled shot did, in the only four numbers a lesson goal is written in. */
export interface LessonResult {
  enemyOff: number
  ownOff: number
  enemiesLeft: number
  ownLeft: number
}

export function readResult(outcome: SimOutcome, settled: SimState): LessonResult {
  return {
    enemyOff: knockedOffOf(outcome, 'opponent').length,
    ownOff: knockedOffOf(outcome, 'player').length,
    enemiesLeft: liveDiscs(settled, 'opponent').length,
    ownLeft: liveDiscs(settled, 'player').length,
  }
}

/**
 * `'passed'` — the goal is met. `'failed'` — it cannot be met from here; put the board back and show
 * the hint. `'again'` — nothing decided yet, keep shooting.
 *
 * Only {@link LESSON_CLEAR} can ever return `'again'`; every other lesson spends its single shot and
 * is therefore decided by it.
 */
export type LessonVerdict = 'passed' | 'failed' | 'again'

export function judgeLesson(lesson: Lesson, result: LessonResult, shotsTaken: number): LessonVerdict {
  const spent = lesson.maxShots > 0 && shotsTaken >= lesson.maxShots

  if (lesson.goal.clearAll) {
    if (result.enemiesLeft === 0) return 'passed'
    // The round's own losing condition, met here for the first time.
    if (result.ownLeft === 0) return 'failed'
    return spent ? 'failed' : 'again'
  }

  const enough = result.enemyOff >= (lesson.goal.knockouts ?? 1)
  const clean = !lesson.goal.keepOwn || result.ownOff === 0
  if (enough && clean) return 'passed'
  return spent ? 'failed' : 'again'
}

// -- the reference ---------------------------------------------------------------------------

/**
 * The chapters of "How to play" — everything the board cannot demonstrate.
 *
 * A chapter is a heading and a list of paragraph keys, and nothing else: no pictures, no
 * per-chapter layout, no ordering rules. That flatness is deliberate — `scenes/HowToPlay.ts` is
 * then one loop, and adding a chapter is one row here plus two rows in each dictionary.
 *
 * **Two chapters deliberately hold almost no copy of their own.** The four rule sets and the five
 * branches of arms are already written down, once, for the screens that pick them
 * (`ruleName*`/`ruleWin*`/`ruleAbout*`, `formation*`), and a help screen that restated them would be
 * a second copy free to drift from the first. {@link HelpChapter.source} names the list to read
 * instead, and `HowToPlay` builds those entries from the game's own data.
 */
export type HelpSource = 'rules' | 'branches'

export interface HelpChapter {
  titleKey: StringKey
  /** Paragraphs, in order. */
  bodyKeys: readonly StringKey[]
  /** A list built from the game's own data, drawn after the paragraphs above. */
  source?: HelpSource
}

export const HELP_CHAPTERS: readonly HelpChapter[] = [
  { titleKey: 'helpGoalTitle', bodyKeys: ['helpGoalA', 'helpGoalB'] },
  { titleKey: 'helpShotTitle', bodyKeys: ['helpShotA', 'helpShotB', 'helpShotC'] },
  { titleKey: 'helpTurnTitle', bodyKeys: ['helpTurnA', 'helpTurnB', 'helpTurnC'] },
  { titleKey: 'helpModesTitle', bodyKeys: ['helpModesA'], source: 'rules' },
  { titleKey: 'helpBranchesTitle', bodyKeys: ['helpBranchesA'], source: 'branches' },
  { titleKey: 'helpScoreTitle', bodyKeys: ['helpScoreA', 'helpScoreB'] },
  { titleKey: 'helpCoinsTitle', bodyKeys: ['helpCoinsA', 'helpCoinsB'] },
  { titleKey: 'helpItemsTitle', bodyKeys: ['helpItemsA', 'helpItemsB', 'helpItemsC'] },
  { titleKey: 'helpRivalsTitle', bodyKeys: ['helpRivalsA', 'opponentNote'] },
  { titleKey: 'helpDailyTitle', bodyKeys: ['helpDailyA'] },
  { titleKey: 'helpFriendTitle', bodyKeys: ['helpFriendA'] },
  { titleKey: 'helpSkinsTitle', bodyKeys: ['helpSkinsA'] },
]
