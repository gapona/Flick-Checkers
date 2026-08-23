import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { migrate } from '../../src/save/migrate'
import { isOpponentUnlocked, opponentsBefore } from '../../src/game/opponents'
import { DEFAULT_RULES_ID } from '../../src/game/rules'
import { DEFAULT_SAVE_STATE, SAVE_SCHEMA_VERSION } from '../../src/save/types'
import { savedRoundIsOver } from '../../src/game/persistence'
import { buildFormation } from '../../src/game/formations'
import { createBoardMetrics } from '../../src/board/layout'
import { createState } from '../../src/sim/types'

/**
 * The `v2 -> v3` ladder step, which is the first one in this project that had to CONVERT rather
 * than default.
 *
 * It gets a test where `v1 -> v2` did not, and the difference is the point: a bump that adds a
 * field can be checked by reading the code, because the failure mode is a missing default. A bump
 * that changes a field's TYPE has a failure mode that looks like success — every player who had
 * muted the game comes back to it at full volume, the save loads without complaint, and nobody
 * finds out until a review mentions it.
 */
describe('save migration', () => {
  const v2 = (settings: unknown): Record<string, unknown> => ({
    v: 2,
    bestScore: 1234,
    coins: 250,
    purchases: ['board-emerald'],
    settings,
    rules: 'classic',
    difficulty: 'hard',
    skins: { board: 'emerald', pieces: 'ember' },
    stats: {},
    match: null,
    daily: { lastPlayed: '2026-08-15', streak: 3, best: 5, solvedToday: true },
  })

  it('turns the old on/off flags into levels', () => {
    const loud = migrate(v2({ sound: true, music: true }))
    assert.ok(loud)
    assert.equal(loud.v, SAVE_SCHEMA_VERSION)
    assert.equal(loud.settings.sfx, 1)
    assert.equal(loud.settings.music, 1)

    const muted = migrate(v2({ sound: false, music: false }))
    assert.ok(muted)
    assert.equal(muted.settings.sfx, 0)
    assert.equal(muted.settings.music, 0)
  })

  it('carries a muted flag across independently per channel', () => {
    const mixed = migrate(v2({ sound: false, music: true }))
    assert.ok(mixed)
    assert.equal(mixed.settings.sfx, 0, 'a player who silenced effects stays silenced')
    assert.equal(mixed.settings.music, 1)
  })

  it('keeps everything else a v2 save owned', () => {
    const state = migrate(v2({ sound: true, music: false }))
    assert.ok(state)
    assert.equal(state.coins, 250)
    assert.equal(state.bestScore, 1234)
    assert.deepEqual(state.purchases, ['board-emerald'])
    assert.equal(state.skins.board, 'emerald')
    assert.equal(state.skins.pieces, 'ember')
    // `v4`'s deriving step: the difficulty is not defaulted away, it becomes the character it most
    // resembled. Hard was 600 candidates with a near-still hand; the marshal is 700 with the same.
    assert.equal(state.opponent, 'marshal')
    assert.equal(state.daily.streak, 3)
  })

  it('seeds the ladder so the derived opponent is actually reachable', () => {
    // The bug this exists for: with `defeated` left empty, only the first three characters are open,
    // so mapping Hard onto the marshal pointed the save at a character the gate refuses — the picker
    // showed nothing selected while the match played the locked one anyway.
    const state = migrate({ ...v2({}), v: 3, settings: { sfx: 1, music: 1 }, difficulty: 'hard' })
    assert.ok(state)
    assert.equal(state.opponent, 'marshal')
    assert.ok(isOpponentUnlocked(state.opponent, state.defeated), 'the derived character must be unlocked')
    assert.deepEqual(state.defeated, opponentsBefore('marshal'))

    // Easy maps inside the free three, so it needs no seeding at all — asserted so a future edit that
    // starts seeding unconditionally has to notice it is inventing wins nobody needed.
    const easy = migrate({ ...v2({}), v: 3, settings: { sfx: 1, music: 1 }, difficulty: 'easy' })
    assert.deepEqual(easy?.defeated, [], 'the bottom rung needs nothing beaten')
  })

  it('maps every retired difficulty onto a character, and never onto the same one', () => {
    // The mapping is the whole point of the step — a returning player who had set Hard must not come
    // back on the weakest character. Asserted per value rather than as a table, so a future edit that
    // collapses two levels onto one character has to say so out loud.
    const of = (difficulty: string) => migrate({ ...v2({}), v: 3, settings: { sfx: 1, music: 1 }, difficulty })?.opponent
    const easy = of('easy')
    const medium = of('medium')
    const hard = of('hard')

    assert.equal(easy, 'recruit')
    assert.equal(medium, 'sergeant')
    assert.equal(hard, 'marshal')
    assert.equal(new Set([easy, medium, hard]).size, 3, 'three levels, three different characters')
    assert.equal(of('not-a-level'), 'sergeant', 'an unreadable difficulty lands on the baseline, not the bottom')
  })

  it('upgrades a v1 save through both steps at once', () => {
    // v1 has neither `match` nor `daily`, AND has the old settings shape — so it exercises the
    // fallthrough and the conversion together, which is the only path a really old save takes.
    const v1 = { ...v2({ sound: false, music: false }), v: 1 }
    delete (v1 as Record<string, unknown>).match
    delete (v1 as Record<string, unknown>).daily

    const state = migrate(v1)
    assert.ok(state)
    assert.equal(state.v, SAVE_SCHEMA_VERSION)
    assert.equal(state.settings.sfx, 0)
    assert.equal(state.match, null, 'nothing to continue')
    assert.equal(state.daily.streak, 0)
    assert.equal(state.coins, 250, 'and the wallet survives the whole ladder')
  })

  it('reads a v3 save back unchanged, including the extremes', () => {
    const v3 = { ...v2({}), v: 3, settings: { sfx: 0, music: 1 } }
    const state = migrate(v3)
    assert.ok(state)
    assert.equal(state.settings.sfx, 0)
    assert.equal(state.settings.music, 1)
  })

  it('repairs a level that is not a level', () => {
    for (const bad of [NaN, Infinity, -3, 5, 'loud', null, undefined]) {
      const state = migrate({ ...v2({}), v: 3, settings: { sfx: bad, music: bad } })
      assert.ok(state)
      assert.ok(state.settings.sfx >= 0 && state.settings.sfx <= 1, `sfx stayed in range for ${String(bad)}`)
      assert.ok(state.settings.music >= 0 && state.settings.music <= 1, `music stayed in range for ${String(bad)}`)
    }
  })

  it('still refuses a version it does not know', () => {
    assert.equal(migrate({ ...v2({}), v: 99 }), null)
    assert.equal(migrate('not a save'), null)
  })

  it('degrades a rule set this build no longer has, without costing the save', () => {
    // Three ids have been retired — `ice`, `casual` and `duel` — and a player mid-match under any of
    // them has a save naming one. The claim is not that the id survives, it is that NOTHING ELSE is
    // lost when it does not: the field falls back to the default and the wallet, the skins and the
    // streak all come through. That is what makes retiring a rule set a cheap change, and it is worth
    // an assertion rather than a paragraph.
    for (const gone of ['casual', 'duel', 'ice', 'not-a-mode']) {
      const state = migrate({ ...v2({}), v: 3, settings: { sfx: 1, music: 1 }, rules: gone })
      assert.ok(state, `${gone} still loaded`)
      assert.equal(state.rules, DEFAULT_RULES_ID, `${gone} fell back to the default`)
      assert.equal(state.coins, 250, `${gone} kept the wallet`)
      assert.deepEqual(state.purchases, ['board-emerald'], `${gone} kept what was bought`)
      assert.equal(state.daily.streak, 3, `${gone} kept the streak`)
    }
  })

  /**
   * Mute has to be reversible ACROSS A RELOAD, which is a different claim from being reversible.
   *
   * The mute button writes `0` into the level, so the value it should come back to is gone the
   * instant it is pressed. Held only in the control's own variable it survives until the page does
   * not — and a player who muted, closed the tab and came back would find un-muting jumps to full
   * instead of returning them to where they were.
   */
  it('remembers the level to un-mute to, through a save round trip', () => {
    // The player sets a quiet level, then mutes. What a save holds at that moment is what a reload
    // gets back.
    const saved = { ...v2({}), v: 3, settings: { sfx: 0, music: 0.35, sfxRestore: 0.4, musicRestore: 0.35 } }

    const reloaded = migrate(JSON.parse(JSON.stringify(saved)))
    assert.ok(reloaded)
    assert.equal(reloaded.settings.sfx, 0, 'still muted after the reload')
    assert.equal(reloaded.settings.sfxRestore, 0.4, 'and knows what to go back to')
    assert.equal(reloaded.settings.music, 0.35, 'an ordinary level survives untouched')
  })

  it('never lets the restore level be silence', () => {
    // A restore of 0 would make un-muting a no-op — the one value it cannot hold.
    for (const bad of [0, -1, NaN, null, undefined, 'loud']) {
      const state = migrate({ ...v2({}), v: 3, settings: { sfx: 0, music: 0, sfxRestore: bad, musicRestore: bad } })
      assert.ok(state)
      assert.ok(state.settings.sfxRestore > 0, `sfxRestore repaired for ${String(bad)}`)
      assert.ok(state.settings.musicRestore > 0, `musicRestore repaired for ${String(bad)}`)
    }
  })

  it('gives a migrated v2 save something to un-mute to', () => {
    const state = migrate(v2({ sound: false, music: false }))
    assert.ok(state)
    assert.equal(state.settings.sfx, 0)
    // The old schema could express no level, so full is the only honest thing to come back to.
    assert.equal(state.settings.sfxRestore, 1)
  })

  it('defaults to the current version', () => {
    assert.equal(DEFAULT_SAVE_STATE.v, SAVE_SCHEMA_VERSION)
    assert.equal(DEFAULT_SAVE_STATE.settings.sfx, 1)
  })
})

/**
 * The state a resumed match must never be dropped into.
 *
 * `Game.finishRound` persists AFTER `recordRound`, so what lands in the save is a decided round on
 * a board that has just been cleared. `startRound` normally overwrites it a moment later — but not
 * if the player leaves from the result panel, or the tab dies while it is up. Adopting that board
 * puts the player on a field with no opponent and a round whose `winner` is still `null`: the HUD
 * says "Your shot" forever with nothing to shoot at, which is a freeze in every way that matters to
 * whoever is holding the phone. It shipped that way, and it was found by playing a match rather
 * than by reading, which is why the predicate now has a test of its own.
 */
describe('resuming a saved board', () => {
  const metrics = createBoardMetrics(8, 64)
  const fresh = () => createState(buildFormation('infantry', metrics, { piecesPerSide: 8 }))

  it('a board mid-round is adopted as it stands', () => {
    assert.equal(savedRoundIsOver(fresh()), false)

    // Three of each side gone is still a round: both sides can still shoot.
    const bitten = fresh()
    for (const side of ['player', 'opponent'] as const) {
      bitten.discs.filter((d) => d.side === side).slice(0, 3).forEach((d) => { d.alive = false })
    }
    assert.equal(savedRoundIsOver(bitten), false)
  })

  it('a board with either side wiped out is a finished round, not a position', () => {
    for (const side of ['player', 'opponent'] as const) {
      const cleared = fresh()
      cleared.discs.filter((d) => d.side === side).forEach((d) => { d.alive = false })
      assert.equal(savedRoundIsOver(cleared), true, `${side} wiped out`)
    }
  })

  it('a mutual wipe-out counts too — there is no round left either way', () => {
    const empty = fresh()
    empty.discs.forEach((d) => { d.alive = false })
    assert.equal(savedRoundIsOver(empty), true)
  })
})

/**
 * The two-player flag on a saved match.
 *
 * It is the one field on `SavedMatch` whose absence has to mean something specific rather than
 * nothing: a record written before the mode existed is a SOLO match, and reading it as anything else
 * would resume somebody's half-finished match against a character with the bot switched off and no
 * second person in the room. `game/persistence.ts`'s `loadMatch` is what turns it into the boolean
 * `Game` reads, so both ends are checked here.
 */
describe('a saved two-player match', () => {
  const board = () => {
    const metrics = createBoardMetrics(8)
    return buildFormation('infantry', metrics, { piecesPerSide: 8 }).map((disc) => ({
      id: disc.id,
      side: disc.side,
      x: disc.x,
      y: disc.y,
      alive: true,
      kind: 'single' as const,
      mass: disc.mass,
      frictionScale: disc.frictionScale,
      restitution: disc.restitution,
      splitImpulse: disc.splitImpulse,
      r: disc.r,
    }))
  }

  const withMatch = (extra: Record<string, unknown>) => ({
    ...DEFAULT_SAVE_STATE,
    v: SAVE_SCHEMA_VERSION,
    match: {
      rules: DEFAULT_RULES_ID,
      roundIndex: 0,
      wins: { player: 0, opponent: 0 },
      first: 'player',
      advance: { player: 0, opponent: 0 },
      score: 0,
      turn: 'player',
      shotsLeft: 1,
      lastHope: null,
      lostADisc: { player: false, opponent: false },
      shots: 0,
      board: board(),
      ...extra,
    },
  })

  it('survives a migrate round trip', () => {
    const state = migrate(withMatch({ twoPlayer: true }))
    assert.ok(state?.match)
    assert.equal(state.match.twoPlayer, true)
  })

  it('a record written before the mode existed is a SOLO match, not an undefined one', () => {
    const state = migrate(withMatch({}))
    assert.ok(state?.match)
    // Explicitly `false` rather than merely falsy: `Game` branches on it to decide whether to build
    // a bot at all, and `undefined` there would be a mode nobody chose.
    assert.equal(state.match.twoPlayer, false)
  })

  it('anything that is not exactly true is solo', () => {
    for (const junk of ['true', 1, {}, null]) {
      const state = migrate(withMatch({ twoPlayer: junk }))
      assert.ok(state?.match)
      assert.equal(state.match.twoPlayer, false, `${JSON.stringify(junk)} should not enable the mode`)
    }
  })
})

/**
 * The tutorial flag.
 *
 * Additive and versionless, like `SavedMatch.twoPlayer` and `bestCombo` before it — so the thing
 * worth pinning down is the same one: a save written before the field existed must read as `false`
 * and not as `undefined`, because `MainMenu` branches on it to decide whether to offer the tutorial
 * at all, and a tri-state there is a button that appears on some saves and not others for no reason
 * anybody chose.
 */
describe('the tutorial flag', () => {
  const v4 = (extra: Record<string, unknown>): Record<string, unknown> => ({
    v: 4,
    bestScore: 0,
    coins: 0,
    purchases: [],
    settings: { sfx: 1, music: 1, sfxRestore: 1, musicRestore: 1 },
    rules: 'classic',
    opponent: 'recruit',
    defeated: [],
    skins: { board: 'default', pieces: 'default' },
    stats: {},
    match: null,
    daily: { lastPlayed: null, streak: 0, best: 0, solvedToday: false },
    ...extra,
  })

  it('a save written before the tutorial existed has not done it', () => {
    const state = migrate(v4({}))
    assert.ok(state)
    assert.equal(state.tutorialDone, false)
  })

  it('survives a round trip', () => {
    const state = migrate(v4({ tutorialDone: true }))
    assert.ok(state)
    assert.equal(state.tutorialDone, true)
  })

  it('anything that is not exactly true has not done it', () => {
    for (const junk of ['true', 1, {}, null]) {
      const state = migrate(v4({ tutorialDone: junk }))
      assert.ok(state)
      assert.equal(state.tutorialDone, false, `${JSON.stringify(junk)} should not count as finished`)
    }
  })

  it('a v1 payload climbs the whole ladder and still has not done it', () => {
    const state = migrate({
      v: 1,
      bestScore: 10,
      coins: 5,
      purchases: [],
      settings: { sound: true, music: false },
      rules: 'classic',
      difficulty: 'easy',
      skins: { board: 'default', pieces: 'default' },
      stats: {},
    })
    assert.ok(state)
    assert.equal(state.tutorialDone, false)
    // And the rest of the ladder still ran — the flag must not have short-circuited anything.
    assert.equal(state.v, SAVE_SCHEMA_VERSION)
    assert.equal(state.settings.music, 0)
  })
})
