import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { DEFAULT_SAVE, launch, open, waitForScene, type GamePage, type Harness } from './harness'

/**
 * The platform's mute, as certification tests it.
 *
 * **Written against somebody else's rejection.** A Playables submission came back with "game audio
 * only activates after the YouTube mute button is turned on and off" — the game launched silent and
 * only the change event woke it. The rule it broke is one this project can break in more than one
 * way, because audibility here is a product of two levels and a platform flag, and the music
 * INSTANCE is destroyed and rebuilt across a platform pause.
 *
 * One of those ways was real and is fixed: mute, background the tab, come back, unmute, and the
 * bed was gone for the rest of the session — `applyMusicAudibility` found no instance to unmute and
 * returned, while the RESUME that would have rebuilt one had already declined to, on the grounds
 * that it would not have been audible. Nothing in the game brought it back short of walking to the
 * menu, which starts the track itself.
 *
 * Driven through `game.events` rather than through a fake SDK: `platform/yt.ts` relays the real
 * `ytgame` callbacks onto exactly this channel, so what the game listens to is what is emitted here
 * (`main.ts` exposes `window.__game` for this, among other things).
 */
describe('the platform mute', () => {
  let harness: Harness

  before(async () => {
    harness = await launch()
  })
  after(async () => {
    await harness.close()
  })

  /** The music bed's live state, or `null` when no instance exists at all. */
  function music(game: GamePage): Promise<{ playing: boolean; muted: boolean; volume: number } | null> {
    return game.page.evaluate(() => {
      const sound = window.__game!.sound as unknown as {
        sounds: { key: string; isPlaying: boolean; mute: boolean; volume: number }[]
      }
      const bed = sound.sounds.find((s) => s.key === 'music')
      return bed ? { playing: bed.isPlaying, muted: bed.mute, volume: bed.volume } : null
    })
  }

  async function emit(game: GamePage, event: string, arg?: unknown): Promise<void> {
    await game.page.evaluate(([name, value]) => window.__game!.events.emit(name as string, value), [event, arg])
    await game.page.waitForTimeout(400)
  }

  it('plays the bed from the menu, and follows the mute both ways', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await waitForScene(game.page, 'MainMenu')
    await game.page.waitForTimeout(900)

    const launched = await music(game)
    assert.ok(launched?.playing, 'the menu should be playing the bed')
    assert.equal(launched.muted, false, 'nothing has muted it yet')

    await emit(game, 'yt-audio-enabled-change', false)
    const muted = await music(game)
    assert.equal(muted?.muted, true, 'the platform mute must silence the bed')
    assert.equal(muted?.volume, 0)

    await emit(game, 'yt-audio-enabled-change', true)
    const back = await music(game)
    assert.ok(back?.playing, 'the bed must still be playing after the mute came off')
    assert.equal(back.muted, false, 'unmuting the platform must unmute the bed')
    assert.ok(back.volume > 0)

    await game.page.close()
  })

  /**
   * The rejection's own shape, reproduced along the path that actually reaches it here.
   *
   * PAUSE destroys the instance (a stopped-but-kept sound leaks one per cycle — see `audio.ts`) and
   * RESUME rebuilds it only if it would be audible, which while muted it would not. So the unmute
   * that follows has nothing to unmute, and this is the assertion that failed before the fix.
   */
  it('brings the bed back when the mute comes off after a pause', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await waitForScene(game.page, 'MainMenu')
    await game.page.waitForTimeout(900)
    assert.ok((await music(game))?.playing, 'the menu should be playing the bed')

    await emit(game, 'yt-audio-enabled-change', false)
    await emit(game, 'yt-pause')
    await emit(game, 'yt-resume')
    // Nothing is playing here and that is correct: the platform still says no audio.
    assert.equal(await music(game), null, 'a muted resume should not have rebuilt the bed')

    await emit(game, 'yt-audio-enabled-change', true)
    const back = await music(game)
    assert.ok(back, 'the bed never came back — this is the rejection this test is named for')
    assert.ok(back.playing, 'the bed exists but is not playing')
    assert.equal(back.muted, false)
    assert.ok(back.volume > 0)

    await game.page.close()
  })
})
