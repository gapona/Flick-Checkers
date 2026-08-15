import * as Phaser from 'phaser'
import { YTEvents } from '../platform/yt'
import { load, save } from './save'
import { DEFAULT_SAVE_STATE, SaveState } from './types'

const SAVE_DEBOUNCE_MS = 2000

let state: SaveState = { ...DEFAULT_SAVE_STATE }
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** Loads the persisted SaveState into the in-memory store. Call once, before scenes start. */
export async function init(): Promise<SaveState> {
  state = await load()
  return state
}

/** The live, in-memory SaveState. Scenes read it directly; mutate only via `mutate()`. */
export function getState(): Readonly<SaveState> {
  return state
}

/** Mutates the in-memory state and schedules a debounced save (see `scheduleSave`). */
export function mutate(mutator: (state: SaveState) => void): void {
  mutator(state)
  scheduleSave()
}

function scheduleSave(): void {
  if (debounceTimer !== null) {
    return
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void save(state)
  }, SAVE_DEBOUNCE_MS)
}

/** Saves immediately, bypassing the debounce. Used for the PAUSE autosave. */
export async function flush(): Promise<void> {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  await save(state)
}

/**
 * Wires an immediate autosave to the platform's PAUSE event (see ../platform/yt.ts) and,
 * as a fallback for outside Playables (dev, or a build reused on another platform), to
 * `pagehide` — without it, a tab closed mid-debounce-window silently loses the last
 * `SAVE_DEBOUNCE_MS` of mutations, since YTEvents.PAUSE only ever fires inside YouTube.
 * `pagehide` over `beforeunload`: the latter is unreliable on mobile.
 */
export function bindAutosave(game: Phaser.Game): void {
  game.events.on(YTEvents.PAUSE, () => {
    void flush()
  })

  window.addEventListener('pagehide', () => {
    void flush()
  })
}
