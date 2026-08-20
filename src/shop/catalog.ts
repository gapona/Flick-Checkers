/**
 * The shop's product list is entirely game-defined — this template ships the TYPE and a
 * simple registration mechanism (`setCatalog`/`getCatalog`), no actual items. A game calls
 * `setCatalog([...])` once (e.g. from `main.ts`, alongside `ui/theme.ts`'s `setTheme()`)
 * before `Shop` is ever opened; `scenes/Shop.ts` reads `getCatalog()` at `create()` time. See
 * CLAUDE.md "Shop Layer".
 */

export type ShopItemKind = 'consumable' | 'unlock'

export interface ShopItem {
  /** Stable id — for `'unlock'`-kind items this is also the key stored in
   * `SaveState.purchases` (`save/types.ts`), so it must never change once shipped. */
  id: string
  priceCoins: number
  /** An i18n key (see `i18n/strings.ts`'s `tOptional()`) for the item's display name — not
   * required to have a dictionary entry; `Shop.ts` falls back to a title-cased `id` for any
   * key with no match, the same "dynamic content, optional translation" convention other
   * generated display-name lookups in this kind of project use. */
  titleKey: string
  /** `'consumable'` — repeatable; `Shop.ts` calls the purchaser's `onPurchase` callback and
   * the game applies whatever effect it wants (grant a hint, extend time, ...); the shop
   * itself only ever debits coins, it has no idea what a consumable "does". `'unlock'` — a
   * one-time buy; its id is pushed into `SaveState.purchases` and the row switches to an
   * "Owned" state instead of being purchasable again. */
  kind: ShopItemKind
}

let catalog: ShopItem[] = []

/** Registers the game's product list, replacing whatever was set before. */
export function setCatalog(items: ShopItem[]): void {
  catalog = items
}

/** The active catalog — `[]` until a game calls `setCatalog()`. */
export function getCatalog(): readonly ShopItem[] {
  return catalog
}
