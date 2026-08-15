export const SAVE_SCHEMA_VERSION = 2 as const

export interface SaveSettings {
  sound: boolean
  music: boolean
}

export interface SaveStateV2 {
  v: 2
  bestScore: number
  /** Shop currency balance — see `src/shop/coins.ts` for the pure earn/spend/afford logic
   * that operates on this field (always via `store.mutate()`), and CLAUDE.md "Shop Layer". */
  coins: number
  /** Ids of every `'unlock'`-kind `ShopItem` (`src/shop/catalog.ts`) ever purchased — a
   * `'consumable'` purchase never appears here, only one-time unlocks do. */
  purchases: string[]
  settings: SaveSettings
}

export type SaveState = SaveStateV2

export const DEFAULT_SAVE_STATE: SaveState = {
  v: SAVE_SCHEMA_VERSION,
  bestScore: 0,
  coins: 0,
  purchases: [],
  settings: {
    sound: true,
    music: true,
  },
}
