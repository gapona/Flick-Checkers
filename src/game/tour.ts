import { getState, mutate } from '../save/store'
import type { SaveState } from '../save/types'

/**
 * The guided tour: which chapters exist, and which this save has already been shown.
 *
 * **A different thing from `game/tutorial.ts`, and the split is by what each can teach.** The
 * lessons there put the player on a live board and make them flick a disc, which works for the
 * gesture, the reach and the cost of losing your own disc. It cannot say what the button in the
 * corner does — there is no way to teach "this is the shop" by making somebody play it. So the tour
 * points at controls and names them, on the screen they are on, and gets out of the way.
 *
 * Pure over a plain `string[]` where it can be: `isChapterSeen` takes the list rather than the
 * store, so a node test can exercise the rule with no browser. The two functions that WRITE go
 * through `mutate()`, like `game/persistence.ts`'s own thin half.
 *
 * `save/migrate.ts` deliberately does NOT import this module — see `SaveStateV4.tour` for why, and
 * for why a chapter id this build does not know is kept rather than dropped.
 *
 * ## Why a chapter per screen rather than one tour
 *
 * The two things a new player has to be told sit on two screens and are met at different moments:
 * what the menu's buttons do, and how a shot is made. One tour would have to either sit the player
 * through the board half before they have a board, or explain a board from the menu. Two chapters
 * are shown where each is true, and the save records them separately — which is also what lets a
 * third be added later without replaying the first two.
 */
export type TourChapter = 'menu' | 'match'

/** Every chapter, in the order a new player meets them. Exported so a test can walk the set rather
 * than restate it. */
export const TOUR_CHAPTERS: readonly TourChapter[] = ['menu', 'match']

export function isTourChapter(id: string): id is TourChapter {
  return (TOUR_CHAPTERS as readonly string[]).includes(id)
}

export function isChapterSeen(seen: readonly string[], chapter: TourChapter): boolean {
  return seen.includes(chapter)
}

/** Whether the tour should open itself on this screen, right now. */
export function shouldRunTour(chapter: TourChapter): boolean {
  return !isChapterSeen(getState().tour ?? [], chapter)
}

/**
 * Files a chapter as shown.
 *
 * Called when the tour ENDS — by finishing it or by skipping it — never when it opens. A player who
 * closes the game halfway through the menu chapter has not been told what the menu does, and the
 * honest thing is to offer it again rather than to count a dialog they dismissed. Skip files it for
 * the opposite reason: a tour somebody declined must not come back every launch. Idempotent, so the
 * last step and a Skip on the last step cannot file it twice.
 */
export function markChapterSeen(chapter: TourChapter): void {
  mutate((state: SaveState) => {
    const seen = state.tour ?? []
    if (seen.includes(chapter)) return
    state.tour = [...seen, chapter]
  })
}

/**
 * Forgets every chapter, so the tour runs again from the beginning.
 *
 * What "Show me around" on the rules page does. It clears the whole list rather than one chapter,
 * because a player asking for the tour again is asking for the tour — and the match half cannot be
 * started from a page with no board behind it anyway. Which screen it then opens on is decided by
 * where the player goes next: each host checks `shouldRunTour` in its own `create()`.
 */
export function resetTour(): void {
  mutate((state: SaveState) => {
    state.tour = []
  })
}
