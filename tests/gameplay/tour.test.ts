/**
 * The guided tour's bookkeeping: which chapters exist, and what a save remembers about them.
 *
 * The half that can be checked without a browser, which is the half where a mistake is silent. A
 * tour that reopens every launch is annoying; a tour that files itself the moment it OPENS is worse,
 * because the player who closed the game halfway through is never offered it again — and neither
 * failure shows up in `tsc` or in a screenshot. `tests/platform/coach.test.ts` owns the other half:
 * that it opens at all, where the card lands, and that the write reaches `localStorage`.
 *
 * Nothing here touches `save/store.ts`. `shouldRunTour`/`markChapterSeen` are three lines over
 * `getState`/`mutate` and driving them in node would mean standing up the whole persistence layer to
 * test a list membership; what is worth pinning down is the RULE, which `isChapterSeen` states
 * purely, plus what `migrate` does with the field.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { isChapterSeen, isTourChapter, TOUR_CHAPTERS } from '../../src/game/tour'
import { migrate } from '../../src/save/migrate'
import { DEFAULT_SAVE_STATE } from '../../src/save/types'

/** A v4 payload with whatever the case under test wants to say about the tour. */
function saved(tour: unknown): Record<string, unknown> {
  return { ...DEFAULT_SAVE_STATE, v: 4, tour }
}

describe('the chapters', () => {
  test('there are two, met in the order a new player meets them', () => {
    assert.deepEqual([...TOUR_CHAPTERS], ['menu', 'match'])
  })

  test('the guard accepts exactly those two', () => {
    for (const chapter of TOUR_CHAPTERS) assert.equal(isTourChapter(chapter), true, chapter)
    for (const junk of ['', 'Menu', 'board', 'shop']) assert.equal(isTourChapter(junk), false, junk)
  })

  test('a fresh save has seen none of them', () => {
    for (const chapter of TOUR_CHAPTERS) {
      assert.equal(isChapterSeen(DEFAULT_SAVE_STATE.tour ?? [], chapter), false, chapter)
    }
  })

  test('one chapter seen does not suppress the other', () => {
    // The whole reason this is a list rather than a flag: the menu and the board are two different
    // explanations met at two different moments, and a third added later must not arrive pre-seen.
    assert.equal(isChapterSeen(['menu'], 'menu'), true)
    assert.equal(isChapterSeen(['menu'], 'match'), false)
  })

  test('a chapter id this build does not know matches nothing', () => {
    // What makes it safe for `migrate` to keep unknown ids: they gate nothing.
    assert.equal(isChapterSeen(['shop-tour', 'menu'], 'match'), false)
    assert.equal(isChapterSeen(['shop-tour', 'menu'], 'menu'), true)
  })
})

describe('what a save remembers', () => {
  test('a payload written before the field existed reads as nothing seen', () => {
    const raw = saved(undefined)
    delete raw.tour
    const state = migrate(raw)
    assert.ok(state)
    assert.deepEqual(state.tour, [])
  })

  test('junk in the field costs the tour and nothing else', () => {
    for (const junk of [null, 'menu', 42, {}, true]) {
      const state = migrate(saved(junk))
      assert.ok(state, `${JSON.stringify(junk)} should not cost the whole save`)
      assert.deepEqual(state.tour, [], `${JSON.stringify(junk)} should normalise to an empty list`)
      assert.equal(state.coins, DEFAULT_SAVE_STATE.coins, 'a bad tour list must not touch the wallet')
    }
  })

  test('non-strings are dropped from the list, strings are kept', () => {
    const state = migrate(saved(['menu', 7, null, 'match', { id: 'menu' }]))
    assert.ok(state)
    assert.deepEqual(state.tour, ['menu', 'match'])
  })

  test('an id this build does not know is KEPT', () => {
    // Deliberately unlike `defeated`, which drops unknown ids: a stale opponent id is a key that
    // unlocks nothing and accumulates, while a stale chapter id is a screen the player has already
    // been walked through. Dropping it would replay a tour whenever a chapter is renamed.
    const state = migrate(saved(['menu', 'shop-tour']))
    assert.ok(state)
    assert.deepEqual(state.tour, ['menu', 'shop-tour'])
  })
})
