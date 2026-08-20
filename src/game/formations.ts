/**
 * Where the discs start, and what they are made of.
 *
 * **Pure TypeScript, no Phaser** — same rule as `game/rules.ts` and `src/sim/`. A formation is data:
 * it produces `Disc`s the solver can step and the bot can search from, with nothing on screen
 * involved.
 *
 * CHAPAEV-PLAN.md §4 is the cheapest content in the whole plan and this file is all of it: the
 * original game already contains five branches of arms, and each is nothing more than a different
 * arrangement plus **one mass number and one friction number**. Five perceptibly different rounds
 * out of one board, one solver and no new screens.
 *
 * ## Where this departs from §4, and why
 *
 * §4 describes artillery as "pairs plus a gun on top" and tanks as "a triangle of three plus one
 * above". Those are descriptions of how the pieces are physically piled on a real board, and §2's
 * trap 2 refuses to model that: a stack is ONE disc with more mass and a second sprite riding on it,
 * which **splits into two** above an impulse threshold. Never a real third dimension, never more
 * than one level.
 *
 * So a stack here is worth exactly two discs. With eight pieces a side that makes four stacks for
 * both artillery and tanks. A literal four-piece tank would leave a side with two discs on the
 * board, which is not a round — it is a coin toss.
 */
import { gridToScreen, isDarkSquare, type BoardMetrics } from '../board/layout'
import { createDisc, DISC_RADIUS, MAX_SPEED, type Disc, type DiscKind, type Side } from '../sim/types'
import type { BranchMark } from '../board/discTextures'
import type { FormationId } from './rules'

/** The order a campaign walks the branches in — §4's "five rounds in a row". Roughly ascending in
 * how strange they feel: infantry is the baseline the others are judged against. */
export const FORMATION_ORDER: readonly FormationId[] = ['infantry', 'cavalry', 'artillery', 'tanks', 'planes']

/**
 * What one branch's discs are made of.
 *
 * `mass` and `frictionScale` are §4's two numbers. `restitution` and `radiusScale` are named in the
 * table for one branch each (planes 0.98, artillery +10%) and left at the default elsewhere.
 */
export interface BranchProfile {
  kind: DiscKind
  /** Which silhouette this branch's stacks wear (`board/discTextures.ts`). `null` for a branch that
   * fields none — the two play very differently, so telling them apart has to be a matter of looking
   * rather than of remembering. */
  top: 'gun' | 'turret' | null
  /**
   * The stencil this branch's discs are printed with.
   *
   * `'none'` exactly where {@link BranchProfile.top} is not: a stack's rider already occupies the
   * face and would cover a mark. Between them the two fields give every branch something to be
   * recognised by, which is what infantry, cavalry and planes lacked — they differed by a 5% radius,
   * which is to say they did not differ.
   */
  mark: BranchMark
  mass: number
  frictionScale: number
  restitution?: number
  radiusScale: number
  /** Discs this branch fields per side. A stack counts as one disc here and two pieces on the
   * board, which is why the stacked branches field half as many. */
  discsPerSide: (piecesPerSide: number) => number
}

/**
 * The impulse a stack has to absorb before it comes apart.
 *
 * Derived rather than guessed: a disc of mass 1 hitting a mass-1.8 stack head-on exchanges
 * `(1 + e) · v / (1/m₁ + 1/m₂)` — about 1420 at full speed and about 400 at a quarter of it. A
 * threshold between them means a solid hit bursts the stack and a nudge does not, which is exactly
 * what §2's trap 2 asks for.
 */
export const STACK_SPLIT_IMPULSE = 0.55 * MAX_SPEED

/**
 * ## Why the friction numbers are spread so much wider than §4's table
 *
 * `npm run verify:branches` measured §4's claim of "five perceptibly different rounds" and found
 * three of the five knobs do nothing:
 *
 * - **`mass` is inert while both sides field the same branch**, which is always. An elastic exchange
 *   along the line of centres goes by the mass RATIO, and the ratio is 1 whatever the number says —
 *   artillery's 1.8 against infantry's 1.0 measured **−1.1%**. It earns its keep in exactly one
 *   place, the stack split, where 1.8 finally meets 0.9.
 * - **`restitution` is nearly inert in a range bounded above by 1**: planes' 0.98 against the
 *   default 0.92 is worth +5.8%.
 * - **`radiusScale` did not separate anything measurable** at ±10-15%.
 *
 * That left `frictionScale` carrying the whole promise on its own, at a spread (×0.85…×1.3) which
 * put infantry, artillery and planes on the *identical* number. So the spread is the one thing
 * edited, and it is edited to a ladder over the three SINGLE-disc branches: each at least 20% from
 * infantry and at least 10% from its nearest neighbour in travel, which is §4's written threshold.
 *
 * **One working axis cannot separate five branches**, which is why the ladder covers three of them.
 * It is bounded above by the board (cavalry already travels 16.5 cells across an 8-cell one) and
 * below by §3's first-move skew, and between those walls there is room for three. The two stacked
 * branches are separated by the split instead — see artillery's own note.
 *
 * **Infantry is deliberately left at ×1.0.** It is the baseline every other branch is judged
 * against, and §11's open calibration question (is a full-power shot travelling 11.5 cells across
 * an 8-cell board right at all?) is asked about exactly this number — moving it would answer two
 * questions with one edit and settle neither. Worth knowing before that question is opened:
 * infantry is now the MOST first-move-skewed branch in the game at 71.3%, against 60.0-65.3 for the
 * four that were retuned.
 *
 * Changing several branches at once is still one change, not several: a round is played by ONE
 * branch on both sides, so no two of these numbers ever meet in the same simulation and none of
 * them can confound another's measurement.
 */
export const BRANCH_PROFILES: Record<FormationId, BranchProfile> = {
  /** The baseline every other branch is felt against, and the one §11 is really about. */
  infantry: { kind: 'single', top: null, mark: 'rifles', mass: 1, frictionScale: 1, radiusScale: 1, discsPerSide: (n) => n },
  /** Lighter and slipperier: travels further, and is knocked off more easily. The far end of the
   * ladder — everything else is judged against how much less ground it covers than this. */
  cavalry: { kind: 'single', top: null, mark: 'horseshoe', mass: 0.9, frictionScale: 0.7, radiusScale: 1, discsPerSide: (n) => n },
  /**
   * Wide and slow to get going. **Its friction is deliberately identical to infantry's**, which
   * looks like an oversight and is the opposite: it is the one value measurement allowed.
   *
   * Artillery at ×1.25 travels the 20% less than infantry that §4's separation threshold asks for,
   * and costs **+11.5 points of first-move skew** (60.0 -> 71.5 over 400 rounds a side, 3.5σ) — the
   * worst regression measured in this pass, and from the branch that otherwise has the FAIREST
   * opening in the game. Its distinction from infantry is not travel and was never the mass: it is
   * that a stack splits. That shows up on `pierce` (2 discs of a queue moved against 1, carried 2.6
   * cells against 6.8) and in play (7.3 shots a round against 9.8, 1.41 knockouts a shot against
   * 1.19), which is a difference the player already has without paying for it at the opening.
   */
  artillery: { kind: 'stack', top: 'gun', mark: 'none', mass: 1.8, frictionScale: 1, radiusScale: 1.1, discsPerSide: (n) => Math.max(1, Math.floor(n / 2)) },
  /**
   * The battering ram: the shortest-range thing on the board.
   *
   * ×1.40 is measured, not interpolated, and the difference matters — **skew is not a smooth
   * function of friction.** ×1.30 gives 71.0, ×1.40 gives 64.0, ×1.55 gives 79.8. A value picked by
   * interpolating between two measured points is a value nobody measured; this one was checked
   * directly, and the ×1.55 that a straight line would have endorsed fails the guard by +8.8.
   */
  /**
   * **×1.15, down from ×1.40, and the two numbers belong to two different games.**
   *
   * ×1.40 was measured and correct under the quadratic power curve this project shipped with. §11's
   * calibration pass replaced that curve (`sim/types.ts`'s `POWER_CURVE`, now 0.6) and the number
   * went stale the moment it did — measured at 400 rounds a side: tanks' first-shooter skew was
   * 64.0 ±2.4 before, **84.8 ±1.8** with the new curve and ×1.40, and **57.5 ±2.5** with the new
   * curve and ×1.15.
   *
   * The mechanism is worth keeping, because it is why this branch and no other broke: tanks' full
   * reach is 8.2 cells against the 6.08 they must cross to touch the enemy rank, so under the old
   * curve the bot's middle powers could not reach AT ALL and a tanks round ran 12.2 shots of mutual
   * flailing that diluted whoever went first. The new curve makes those powers land, the round drops
   * to ~10 shots, and the opening advantage stops being diluted. Slipperier gives the round its
   * length back.
   *
   * So: **do not move this without re-measuring the curve, and do not move the curve without
   * re-measuring this.** `npm run verify:branches --branch tanks --skew-only --rounds 400 --curve X`
   * measures both arms from one build.
   */
  tanks: { kind: 'stack', top: 'turret', mark: 'none', mass: 2.5, frictionScale: 1.15, radiusScale: 1.15, discsPerSide: (n) => Math.max(1, Math.floor(n / 2)) },
  /** Light and almost perfectly elastic: ricochets off everything and goes where it likes. */
  planes: { kind: 'single', top: null, mark: 'aircraft', mass: 0.7, frictionScale: 0.82, restitution: 0.98, radiusScale: 0.95, discsPerSide: (n) => n },
}

export interface FormationOptions {
  /** Pieces per side, before a stacked branch halves it into discs. 8 is the board game. */
  piecesPerSide?: number
  /**
   * Rows this side's formation starts further up the board than usual, per side.
   *
   * §3's `advanceOnCleanWin`: a side that won a round without losing a disc sets up closer to the
   * enemy in the next one. Earned by `game/round.ts`'s `summarise()`; spent here.
   */
  advance?: Partial<Record<Side, number>>
}

/** A cell offset from a side's own back rank: `0` is the home row, `1` the one in front of it. */
interface HomeCell {
  col: number
  depth: number
}

/**
 * Turns home-relative cells into real discs for both sides.
 *
 * The mirroring is the point: `depth` counts inward from each side's own edge, so one layout
 * description produces both formations and they cannot drift apart.
 */
function build(cells: HomeCell[], profile: BranchProfile, metrics: BoardMetrics, options: FormationOptions): Disc[] {
  const discs: Disc[] = []
  let id = 0

  const place = (side: Side): void => {
    const advance = options.advance?.[side] ?? 0
    for (const cell of cells) {
      const depth = cell.depth + advance
      const row = side === 'player' ? metrics.size - 1 - depth : depth
      const at = gridToScreen(metrics, cell.col, row)
      discs.push(
        createDisc({
          id: id++,
          side,
          x: at.x,
          y: at.y,
          kind: profile.kind,
          mass: profile.mass,
          frictionScale: profile.frictionScale,
          restitution: profile.restitution,
          r: DISC_RADIUS * profile.radiusScale,
          splitImpulse: profile.kind === 'stack' ? STACK_SPLIT_IMPULSE : 0,
        }),
      )
    }
  }

  place('opponent')
  place('player')
  return discs
}

/** Columns centred on the board, so a formation of fewer than `size` discs sits in the middle of its
 * rank rather than bunched against one corner. */
function centredColumns(count: number, metrics: BoardMetrics): number[] {
  const first = Math.floor((metrics.size - count) / 2)
  return Array.from({ length: count }, (_, i) => first + i)
}

/** §4's infantry: one disc per column along the back rank — the opening the physical game is played
 * from. A full cell between neighbours, so the row is a wall you can break but not a solid bar. */
function infantryCells(count: number, metrics: BoardMetrics): HomeCell[] {
  return centredColumns(count, metrics).map((col) => ({ col, depth: 0 }))
}

/**
 * §4's cavalry: the dark squares of the two home rows.
 *
 * `isDarkSquare` is defined on absolute `(col, row)`, so which columns are dark differs between the
 * two home rows — which is the whole visual point, a staggered double rank rather than two solid
 * lines. Taken per side against that side's own real rows.
 */
function cavalryCells(count: number, metrics: BoardMetrics): HomeCell[] {
  const cells: HomeCell[] = []
  for (let depth = 0; depth < metrics.size && cells.length < count; depth++) {
    for (let col = 0; col < metrics.size && cells.length < count; col++) {
      // Measured against the PLAYER's rows; `build` mirrors the whole pattern for the opponent, so
      // both sides get the same staggered shape rather than one of them getting the light squares.
      if (isDarkSquare(col, metrics.size - 1 - depth)) cells.push({ col, depth })
    }
  }
  return cells
}

/** Stacked branches sit on the home rank, spread out — a stack is worth two pieces, so there are
 * half as many of them and they need the room. */
function stackedCells(count: number, metrics: BoardMetrics): HomeCell[] {
  const step = Math.max(1, Math.floor(metrics.size / count))
  const used = (count - 1) * step + 1
  const first = Math.floor((metrics.size - used) / 2)
  return Array.from({ length: count }, (_, i) => ({ col: first + i * step, depth: 0 }))
}

/**
 * §4's planes: sparse, and further into the board than anything else.
 *
 * Starting forward is not a bonus — it is the branch's whole character. A disc with 0.98 restitution
 * that begins in the open has nothing to hide behind and ricochets into the middle of everything.
 */
function planeCells(count: number, metrics: BoardMetrics): HomeCell[] {
  const cells: HomeCell[] = []
  const perRow = Math.max(1, Math.ceil(count / 3))

  // Every other column, staggered row by row, across the FULL width — a sparse screen rather than a
  // block. The row limit is what pushes the overflow deeper into the board instead of widening the
  // first rank, and the loop runs until the count is met rather than for a fixed number of rows, so
  // a smaller or larger side still fields exactly what it was asked for.
  for (let depth = 0; depth < metrics.size && cells.length < count; depth++) {
    let placed = 0
    for (let col = depth % 2; col < metrics.size && placed < perRow && cells.length < count; col += 2) {
      cells.push({ col, depth })
      placed++
    }
  }
  return cells
}

/**
 * Builds a branch's opening position for both sides.
 *
 * The disc ids are assigned once, here, and are stable for the whole round — `sim/types.ts` explains
 * why they matter (they fix the solver's traversal order, which is half of its determinism, and they
 * survive the state cloning the bot does constantly).
 */
export function buildFormation(formation: FormationId, metrics: BoardMetrics, options: FormationOptions = {}): Disc[] {
  const pieces = Math.min(options.piecesPerSide ?? 8, metrics.size)
  const profile = BRANCH_PROFILES[formation]
  const count = Math.min(profile.discsPerSide(pieces), metrics.size)

  switch (formation) {
    case 'cavalry':
      return build(cavalryCells(count, metrics), profile, metrics, options)
    case 'artillery':
    case 'tanks':
      return build(stackedCells(count, metrics), profile, metrics, options)
    case 'planes':
      return build(planeCells(count, metrics), profile, metrics, options)
    case 'infantry':
    default:
      return build(infantryCells(count, metrics), profile, metrics, options)
  }
}

/** The opening position for §4's baseline branch. Kept as its own name because a great deal of code
 * and several tests want "just a normal board" without caring which branch that is. */
export function infantryFormation(metrics: BoardMetrics, options: FormationOptions = {}): Disc[] {
  return buildFormation('infantry', metrics, options)
}
