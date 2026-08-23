/**
 * The game's economy as pure data and pure functions (GAME-PLAN.md §8): what is for sale, what
 * a finished round or match pays, and which skin is actually in force.
 *
 * **No Phaser and no `save/store.ts` import** — same rule as `game/rules.ts`, `board/layout.ts`
 * and the coming `src/sim/`. Everything here takes the balance / purchase list / saved id as
 * arguments, so the whole economy is testable under plain `node` and the store mutations stay in
 * one place (`game/wallet.ts`).
 */
import { DEFAULT_BOARD_SET, DEFAULT_PIECE_SET, isBoardSetId, isPieceSetId, type BoardSetId, type PieceSetId, DEFAULT_EFFECT_SET, isEffectSetId, type EffectSetId } from './skins'
import type { ShopItem } from '../shop/catalog'
import { hasPurchased } from '../shop/coins'

/** Who won, from the PLAYER's point of view. No draw: a round ends when one side has nothing left
 * on the board (`game/rules.ts`'s `RulesRecord` note). */
export type MatchOutcome = 'ongoing' | 'won' | 'lost'

/**
 * The three themed sets sold on top of the free `'default'` one.
 *
 * **The item id IS the skin id.** A shop item's id is permanent because it is what lands in
 * `SaveState.purchases`, and a skin id is permanent because it is what lands in
 * `SaveState.skins` — one string with one lifetime is strictly safer than two that have to be
 * kept in step, and it makes "is this skin owned" a direct `hasPurchased()` call.
 *
 * Prices are set against {@link MATCH_REWARD} and the rewarded top-up (50): the first set is
 * roughly four won matches or three ads, the last one a genuine goal rather than an afternoon.
 */
export const BOARD_ITEM_PREFIX = 'board-'
export const PIECE_ITEM_PREFIX = 'pieces-'
/** The third namespace, and the same rule: an item id is permanent once shipped. */
export const EFFECT_ITEM_PREFIX = 'fx-'

/** `'emerald'` -> `'board-emerald'`. The shop item id and the set id are deliberately NOT the same
 * string any more: two independent slots can both hold a set called `default`, and one flat
 * `purchases` list cannot tell those apart. The prefix is what keeps the two namespaces from
 * colliding, and it is why {@link isBoardUnlocked} and {@link isPieceUnlocked} exist as a pair
 * rather than one shared helper. */
export function boardItemId(id: BoardSetId): string {
  return `${BOARD_ITEM_PREFIX}${id}`
}

export function pieceItemId(id: PieceSetId): string {
  return `${PIECE_ITEM_PREFIX}${id}`
}

export function effectItemId(id: EffectSetId): string {
  return `${EFFECT_ITEM_PREFIX}${id}`
}

/**
 * The board sets on sale, on top of the free `'default'`.
 *
 * Priced against {@link MATCH_REWARD} and the rewarded top-up (50) exactly as before, but the
 * ladder is finer than the old three-bundle one: splitting the wardrobe into a board slot and a
 * piece slot means a purchase can be smaller and still change how the game looks, so the first
 * step down is roughly two won matches rather than four.
 */
export const BOARD_ITEMS: readonly ShopItem[] = [
  { id: boardItemId('emerald'), priceCoins: 100, titleKey: 'boardEmerald', kind: 'unlock' },
  { id: boardItemId('sunset'), priceCoins: 140, titleKey: 'boardSunset', kind: 'unlock' },
  { id: boardItemId('frost'), priceCoins: 180, titleKey: 'boardFrost', kind: 'unlock' },
  { id: boardItemId('sand'), priceCoins: 220, titleKey: 'boardSand', kind: 'unlock' },
  { id: boardItemId('crimson'), priceCoins: 260, titleKey: 'boardCrimson', kind: 'unlock' },
  { id: boardItemId('ink'), priceCoins: 320, titleKey: 'boardInk', kind: 'unlock' },
  { id: boardItemId('plum'), priceCoins: 360, titleKey: 'boardPlum', kind: 'unlock' },
  { id: boardItemId('moss'), priceCoins: 400, titleKey: 'boardMoss', kind: 'unlock' },
  { id: boardItemId('slate'), priceCoins: 440, titleKey: 'boardSlate', kind: 'unlock' },
]

/** The disc palettes on sale, on top of the free `'classic'`. */
export const PIECE_ITEMS: readonly ShopItem[] = [
  { id: pieceItemId('ember'), priceCoins: 90, titleKey: 'piecesEmber', kind: 'unlock' },
  { id: pieceItemId('tide'), priceCoins: 130, titleKey: 'piecesTide', kind: 'unlock' },
  { id: pieceItemId('bone'), priceCoins: 170, titleKey: 'piecesBone', kind: 'unlock' },
  { id: pieceItemId('bloom'), priceCoins: 240, titleKey: 'piecesBloom', kind: 'unlock' },
  { id: pieceItemId('copper'), priceCoins: 280, titleKey: 'piecesCopper', kind: 'unlock' },
  { id: pieceItemId('signal'), priceCoins: 330, titleKey: 'piecesSignal', kind: 'unlock' },
  { id: pieceItemId('amethyst'), priceCoins: 380, titleKey: 'piecesAmethyst', kind: 'unlock' },
]

/** The particle wardrobe on sale, on top of the free `'classic'`. Priced under the wardrobes:
 * a burst is seen for half a second and a board is seen for the whole match. */
export const EFFECT_ITEMS: readonly ShopItem[] = [
  { id: effectItemId('dust'), priceCoins: 120, titleKey: 'fxDust', kind: 'unlock' },
  { id: effectItemId('embers'), priceCoins: 200, titleKey: 'fxEmbers', kind: 'unlock' },
  { id: effectItemId('coins'), priceCoins: 300, titleKey: 'fxCoins', kind: 'unlock' },
]

/**
 * The two consumables of §8, and note what they are NOT: the draughts project sold a hint and an
 * undo, both of which answer the question the game is asking. Neither survives here, because a
 * flick game's question is "can you aim this", and nothing purchasable may answer that.
 *
 * A retake gives back one shot per round — it costs the player the information they already spent,
 * not the skill. A power shot raises the impulse ceiling for one shot; where it goes is still
 * entirely on the player's thumb.
 *
 * They are bought from the gameplay HUD, not the `Shop` screen: both only mean anything with a
 * live round in front of the player. They are still catalog items so a price lives in exactly one
 * place, and `Shop` is opened with {@link SKIN_ITEMS} rather than the whole catalog — a row that
 * debited coins from a menu and applied nothing would be a pure coin sink.
 */
export const RETAKE_ITEM: ShopItem = { id: 'retake', priceCoins: 20, titleKey: 'retakeShot', kind: 'consumable' }
export const POWER_SHOT_ITEM: ShopItem = { id: 'power', priceCoins: 15, titleKey: 'powerShot', kind: 'consumable' }

/** Everything the game sells, in menu order — registered once via `setCatalog()` in `main.ts`. */
export const CATALOG: readonly ShopItem[] = [...BOARD_ITEMS, ...PIECE_ITEMS, ...EFFECT_ITEMS, RETAKE_ITEM, POWER_SHOT_ITEM]

/**
 * What a finished match pays out.
 *
 * §8 names the rewarded ad as the way to TOP UP a balance, not as the only way to have one — a
 * game that pays nothing for playing it makes its own shop an advertising screen. A loss still
 * pays something small: the alternative is that a losing streak locks the player out of the
 * economy entirely, which is the one state that makes a retake unbuyable exactly when it is wanted.
 */
export const MATCH_REWARD = { win: 30, loss: 4 } as const

/** A won round inside a match (§8: coins for a round AND for the match). Small on purpose — a
 * best-of-5 pays 5×8 = 40 at most on top of the match itself, so grinding rounds never out-earns
 * finishing them. */
export const ROUND_REWARD = 8

/**
 * A multi-knockout shot (§5's combo counter) pays per EXTRA disc past the first. One knockout is
 * the game working; two in one shot is the thing the player will try to do again, and paying for
 * it is the cheapest possible way to say so.
 */
export const COMBO_COIN_PER_EXTRA = 3

/**
 * Solving the daily (§7, §8).
 *
 * Worth more than a round and less than a match: it is one shot, but it is the shot the whole day
 * offers, and a streak has to be worth keeping.
 */
export const DAILY_REWARD = 25

/** Coins for a finished match, from the PLAYER's point of view. A match still in progress pays
 * nothing, so this is safe to call from a general "the state changed" path. */
export function matchReward(outcome: MatchOutcome): number {
  if (outcome === 'ongoing') return 0
  return outcome === 'won' ? MATCH_REWARD.win : MATCH_REWARD.loss
}

/** Coins for one shot that knocked `knockouts` enemy discs off. Pays nothing below two — the
 * bonus is for the combo, and the round reward already covers ordinary progress. */
export function comboReward(knockouts: number): number {
  return knockouts < 2 ? 0 : (knockouts - 1) * COMBO_COIN_PER_EXTRA
}

/** Whether a skin may be equipped. `'default'` is free and always owned; everything else is a
 * one-time unlock keyed by its own id. */
export function isBoardUnlocked(id: BoardSetId, purchases: readonly string[]): boolean {
  return id === DEFAULT_BOARD_SET || hasPurchased(purchases, boardItemId(id))
}

export function isPieceUnlocked(id: PieceSetId, purchases: readonly string[]): boolean {
  return id === DEFAULT_PIECE_SET || hasPurchased(purchases, pieceItemId(id))
}

/**
 * The set actually in force, from the raw saved id and the purchase list.
 *
 * Falls back to the free set for anything unrecognised OR not owned, rather than trusting the
 * save: the id is a plain string in a file the player can edit, and a build that dropped a set
 * would otherwise ask for a palette that no longer exists.
 */
export function equippedBoardSet(saved: string, purchases: readonly string[]): BoardSetId {
  if (!isBoardSetId(saved)) return DEFAULT_BOARD_SET
  return isBoardUnlocked(saved, purchases) ? saved : DEFAULT_BOARD_SET
}

/** Same shape as the other two slots: an id this build does not have, or one nobody bought, falls
 * back to the free set rather than costing the player the rest of their wardrobe. */
export function equippedEffectSet(saved: string, purchases: readonly string[]): EffectSetId {
  if (!isEffectSetId(saved)) return DEFAULT_EFFECT_SET
  return saved === DEFAULT_EFFECT_SET || purchases.includes(effectItemId(saved)) ? saved : DEFAULT_EFFECT_SET
}

export function equippedPieceSet(saved: string, purchases: readonly string[]): PieceSetId {
  if (!isPieceSetId(saved)) return DEFAULT_PIECE_SET
  return isPieceUnlocked(saved, purchases) ? saved : DEFAULT_PIECE_SET
}
