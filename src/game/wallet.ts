/**
 * The store-touching half of the economy: everything that reads or writes `SaveState.coins`,
 * `.purchases` and `.skins` goes through here, exactly as `game/persistence.ts` owns `.rules` /
 * `.difficulty` / `.stats` / `.bestScore`.
 *
 * The split is the same one `src/game/economy.ts` explains: prices, payouts and "which skin is in
 * force" are pure functions over plain values (testable under plain `node`), and this module is
 * the thin layer that feeds them the live save and writes the result back. Writes go via
 * `store.mutate()`, which debounces to one platform write every 2s (see `save/store.ts`).
 */
import type { BoardSetId, EffectSetId, PieceSetId } from './skins'
import { getState, mutate } from '../save/store'
import { earnCoins, spendCoins } from '../shop/coins'
import type { ShopItem } from '../shop/catalog'
import { comboReward, equippedBoardSet, equippedPieceSet, matchReward, ROUND_REWARD, type MatchOutcome, equippedEffectSet} from './economy'

export function coinBalance(): number {
  return getState().coins
}

/**
 * The two sets actually in force, each validated against both the shipped list and the purchase
 * list, so a hand-edited or stale save can never point the board or the discs at a palette that
 * does not exist.
 *
 * They are read APART, which is the change: `SaveState.skins` always had separate `board` and
 * `pieces` fields, and until now both were written with the same id and only one was ever read.
 * A board set and a disc set are now bought, worn and priced independently.
 */
export function activeBoardSet(): BoardSetId {
  const state = getState()
  return equippedBoardSet(state.skins.board, state.purchases)
}

export function activePieceSet(): PieceSetId {
  const state = getState()
  return equippedPieceSet(state.skins.pieces, state.purchases)
}

export function activeEffectSet(): EffectSetId {
  const state = getState()
  return equippedEffectSet(state.skins.effects ?? '', state.purchases)
}

export function equipEffectSet(id: EffectSetId): void {
  mutate((state) => {
    state.skins.effects = id
  })
}

export function equipBoardSet(id: BoardSetId): void {
  mutate((state) => {
    state.skins.board = id
  })
}

export function equipPieceSet(id: PieceSetId): void {
  mutate((state) => {
    state.skins.pieces = id
  })
}

/**
 * Pays for one item, or returns `false` and changes nothing.
 *
 * The whole read-check-write sequence lives inside ONE `store.mutate()` call, and
 * `spendCoins()`'s null-on-insufficient-funds return is what makes that safe without a separate
 * pre-check that could race a mutation between the check and the deduction (CLAUDE.md "Shop
 * Layer" → Atomicity). `scenes/Shop.ts` runs the same sequence for its own rows; it is template
 * code and deliberately does not import this game-level module.
 */
export function spendOn(item: ShopItem): boolean {
  const state = getState()
  if (item.kind === 'unlock' && state.purchases.includes(item.id)) return false

  let spent = false
  mutate((s) => {
    const remaining = spendCoins(s.coins, item.priceCoins)
    if (remaining === null) return
    s.coins = remaining
    if (item.kind === 'unlock') s.purchases.push(item.id)
    spent = true
  })
  return spent
}

/** Credits an amount and returns it, for a HUD readout to show. Rejects zero/negative so a caller
 * computing a reward from gameplay can hand the result straight over. */
export function awardCoins(amount: number): number {
  if (amount <= 0) return 0
  mutate((state) => {
    state.coins = earnCoins(state.coins, amount)
  })
  return amount
}

/** The payout for a won round inside a match (§8). */
export function awardRoundCoins(): number {
  return awardCoins(ROUND_REWARD)
}

/** The payout for one shot that knocked several enemy discs off — nothing below two (§5). */
export function awardComboCoins(knockouts: number): number {
  return awardCoins(comboReward(knockouts))
}

/** Credits the payout for a finished match. Pays nothing (and writes nothing) for a match still
 * in progress. */
export function awardMatchCoins(outcome: MatchOutcome): number {
  return awardCoins(matchReward(outcome))
}
