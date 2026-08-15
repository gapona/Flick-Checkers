/**
 * Pure, store-agnostic shop-currency logic — mirrors this template's general "plain
 * functions over primitives, mutate the store at the call site" pattern (see
 * `save/store.ts`'s `mutate()`). Nothing here touches `SaveState` or the store directly, so
 * it's trivially unit-testable and reusable outside a Phaser scene.
 */

/** Whether `coins` covers `price` — a read-only query, for deciding whether to render a buy
 * affordance as enabled without mutating anything. */
export function canAfford(coins: number, price: number): boolean {
  return coins >= price
}

/** New balance after crediting `amount` (floored, never negative — a caller passing a
 * negative/fractional value can't accidentally shrink the balance through this function). */
export function earnCoins(coins: number, amount: number): number {
  return coins + Math.max(0, Math.floor(amount))
}

/**
 * New balance after spending `price`, or `null` if `coins` doesn't cover it — never
 * partially deducts; there is no intermediate state between "can't afford, balance
 * unchanged" and "affordable, balance now reduced by exactly `price`". Callers should run
 * the whole read-check-write sequence inside one `store.mutate()` call (see `Shop.ts`'s
 * `purchase()`) so no other mutation can interleave between the check and the deduction.
 */
export function spendCoins(coins: number, price: number): number | null {
  if (price < 0 || coins < price) return null
  return coins - price
}

/** Whether `itemId` (an `'unlock'`-kind `ShopItem`'s id) is already in `purchases`. */
export function hasPurchased(purchases: readonly string[], itemId: string): boolean {
  return purchases.includes(itemId)
}
