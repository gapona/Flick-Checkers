/**
 * The rule sets, as a flat object of flags (CHAPAEV-PLAN.md §3).
 *
 * **Pure TypeScript — this module must never import Phaser**, same rule as `board/layout.ts` and
 * the coming `src/sim/`: rules are data, and data that a plain `node` test can read is data the
 * test matrix of S6 can enumerate without a browser.
 *
 * The shape is lifted wholesale from the draughts project's `rules/rulesets.ts`, which earned it:
 * every set is the SAME code path reading different flags, so a new variant is a row in a table
 * rather than a branch in the round logic, and two sets differing by exactly one flag are a ready
 * made test pair. Nothing here decides anything — `scenes/Game.ts` and the round logic of S6 read
 * these values; this file only writes them down.
 */

/** The five branches of arms (§4). Each is a starting formation plus a mass/friction tweak on the
 * disc — different rounds out of one board and one solver, no new screens. */
export const FORMATION_IDS = ['infantry', 'cavalry', 'artillery', 'tanks', 'planes'] as const
export type FormationId = (typeof FORMATION_IDS)[number]

/** **`ice` was here and has been removed.** It was §5's other board modifier — two slick bands
 * across the middle at friction ×0.3 — and as a mode it earned nothing: it changed how far a shot
 * carried without changing what a shot was FOR, so the round played out the same with an extra
 * variable the player could not aim with. Cut on that basis, along with the whole friction-zone
 * machinery it was the only caller of (`sim/types.ts`'s `IceZone`, `step.ts`'s per-disc zone test).
 * `pits` is kept because it changes where it is safe to leave a disc, which is a decision.
 *
 * **`casual` is gone too, merged into `classic`** — see {@link CLASSIC_RULES} for which of the two
 * survived and why — and **`duel` is now `blitz`**, at five seconds rather than eight.
 *
 * A rule-set id is not permanent the way a shop item id is: it appears in a save's `rules` field and
 * in a saved match, and both already degrade — `isRulesId` rejects an id this build does not have, so
 * the field falls back to {@link DEFAULT_RULES_ID} and a match saved under a departed set is dropped
 * as "nothing to continue". That is why renaming one is cheap and renaming a shop item is not. */
export const RULES_IDS = ['classic', 'bumper', 'blitz', 'pits'] as const
export type RulesId = (typeof RULES_IDS)[number]

export interface ChapaevRules {
  id: RulesId
  /** Discs per side. Eight is the board-game original. */
  piecesPerSide: number
  formation: FormationId
  /**
   * Knocked an enemy off — shoot again.
   *
   * **No shipped rule set turns this on, and the flag is kept anyway.** It was the default
   * and it was the main source of the first-move skew, because an extra shot takes two things off
   * the opponent rather than one: a disc, and the turn. The side that opened kept opening, the
   * material lead compounded on a board it never handed back, and the compound grew with every
   * knockout. Strict alternation is the fix, and `npm run verify:balance` is the measurement — see
   * `CHAPAEV-PLAN.md` §3.
   *
   * The reward for a good shot did not disappear, it moved: §5's combo multiplier already pays two
   * discs in one shot 400 rather than 200, which rewards the same skill without also handing over
   * the opponent's turn.
   *
   * Kept because an arcade mode built on it is a real thing to want, and a flag every code path
   * already reads costs nothing to leave in place — `tests/gameplay/round.test.ts` still covers both
   * sides of it, so it cannot rot.
   */
  extraShotOnKnockout: boolean
  /** Knocked one of your OWN off — the opponent shoots twice. */
  ownOffIsPenalty: boolean
  /** A shot that touches no enemy is penalised. */
  mustTouchEnemy: boolean
  /** One disc left, on your last rank: you shoot first next round. The original's own comeback
   * rule, and a better one than anything invented to replace it. */
  lastHopeStrike: boolean
  /** Won a round without losing a disc — advance your formation up the board next round. */
  advanceOnCleanWin: boolean
  /** The rim bounces instead of letting a disc fall off. */
  bumperRim: boolean
  /** §5's pits: holes that swallow a disc whose centre enters one. */
  pits: boolean
  /** Per-shot timer in ms; `0` disables it. */
  shotClockMs: number
}

/**
 * **The default set, and the only core one — `casual` and `classic` used to be two.**
 *
 * They differed by exactly two flags, `mustTouchEnemy` and `advanceOnCleanWin`, which on a mode card
 * reads as two nearly identical descriptions of the same game. A picker whose first two entries a
 * player cannot tell apart is worse than a picker with one fewer entry, so they are one set now, under
 * the name the board game has a claim to.
 *
 * **Which half survived, and why it was the lenient half.** Merging is a change to the LIST; making
 * the default game harsher would be a change to the GAME, and only the first was asked for. So this
 * carries the old casual flags verbatim — same turn structure, same penalties, same measurements. The
 * two demands the board game adds stay `false`, each for its own reason:
 *
 * - `mustTouchEnemy` — a beginner's shot that sails through a gap is already punished by having
 *   achieved nothing, and punishing it twice is how a new player concludes the game dislikes them.
 * - `advanceOnCleanWin` — it rewards the round winner with ground, which snowballs a match that is
 *   already best-of-five.
 *
 * Both remain live, tested flags (`tests/gameplay/round.test.ts` exercises each on AND off), so
 * turning this set into the board game's own is two lines here and nothing else. That is the switch to
 * reach for if the game reads as too soft on live players — §11's calibration pass, not a code change.
 *
 * `extraShotOnKnockout` is stated explicitly rather than left to a default for the reason its own note
 * gives: `false` here is a measured balance decision, not an inherited accident.
 */
export const CLASSIC_RULES: ChapaevRules = {
  id: 'classic',
  piecesPerSide: 8,
  formation: 'infantry',
  extraShotOnKnockout: false,
  ownOffIsPenalty: true,
  mustTouchEnemy: false,
  lastHopeStrike: true,
  advanceOnCleanWin: false,
  bumperRim: false,
  pits: false,
  shotClockMs: 0,
}

/**
 * Rim bounces (§5). Not a difficulty setting — a different game: banking off the wall becomes a
 * shot, and the main way to lose a disc stops existing. §11's open question is whether real players
 * find the classic no-rim board punishing enough that THIS should be the default; until that is
 * answered on live players it stays a mode.
 *
 * **The pits are not a garnish here, they are the win condition, and without them this mode could
 * not be finished at all.** Walls that bounce mean a disc's centre never crosses the edge, and a
 * disc is only ever removed by its centre leaving the board or entering a pit — so with `pits` off
 * there is no way to take a single disc off, by either side. Measured before this was fixed: six
 * rounds of Hard against Hard, **zero finished**, all six ran to the 200-shot ceiling, and the
 * number of discs removed across all of them was **0**. The five other rule sets finish in about
 * ten shots.
 *
 * That is why the pairing is written here rather than left to a mode picker: `bumperRim` without a
 * sink is not a harder game, it is a game with no end, and anything that turns the pits off in this
 * set brings that straight back.
 */
export const BUMPER_RULES: ChapaevRules = { ...CLASSIC_RULES, id: 'bumper', bumperRim: true, pits: true }

/**
 * **Blitz: five seconds a shot** (§5). Good for the platform's tempo, bad for a first-timer — mode
 * only.
 *
 * Was `duel` at eight seconds. Five is a different mode rather than a tighter one: eight is enough
 * time to line a shot up and hurry, which makes the clock a nag; five is not, which makes it the
 * rule. Renaming it cost nothing — a rule-set id only ever appears in a save, where `isRulesId`
 * already rejects one this build does not have and the field falls back to the default.
 */
export const BLITZ_RULES: ChapaevRules = { ...CLASSIC_RULES, id: 'blitz', shotClockMs: 5000 }

/**
 * §5's board modifier, as its own mode — and the surviving one of the two the plan asked for; see
 * {@link RULES_IDS} for why `ice` is gone.
 *
 * Its own mode rather than a flag mixed into another set, because the plan's instruction — "only in
 * separate modes, never in the classic" — is about being able to tell what a modifier did.
 */
export const PIT_RULES: ChapaevRules = { ...CLASSIC_RULES, id: 'pits', pits: true }

const RULE_SETS: Record<RulesId, ChapaevRules> = {
  classic: CLASSIC_RULES,
  bumper: BUMPER_RULES,
  blitz: BLITZ_RULES,
  pits: PIT_RULES,
}

export const DEFAULT_RULES_ID: RulesId = 'classic'

/** Narrows a raw string — one out of the save file, which may predate a rename or have been
 * hand-edited — to a set this build actually has. */
export function isRulesId(value: string): value is RulesId {
  return (RULES_IDS as readonly string[]).includes(value)
}

export function getRuleSet(id: RulesId): ChapaevRules {
  return RULE_SETS[id]
}

/** Every set, in menu order. */
export const ALL_RULE_SETS: readonly ChapaevRules[] = RULES_IDS.map((id) => RULE_SETS[id])
