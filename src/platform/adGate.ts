import type * as Phaser from 'phaser'
import { YTEvents, isPlatformPaused, requestInterstitialAd, requestRewardedAd } from './yt'

/**
 * The only entry point for showing ads. Game code must never call `yt.ts`'s
 * `requestInterstitialAd()`/`requestRewardedAd()` directly — see CLAUDE.md "Ad Gate".
 *
 * Pauses gameplay for the ad's duration by emitting the *same* `YTEvents.PAUSE`/`RESUME`
 * that a real platform pause uses, rather than pausing scenes/muting audio/flushing the
 * save itself — those already happen via `lifecycle.ts`, `audio.ts`, and `store.ts`'s
 * existing listeners on that channel, so this module adds no pause logic of its own, only
 * triggers the existing kind.
 */
async function withAdPause<T>(game: Phaser.Game, request: () => Promise<T>): Promise<T> {
  // Snapshot *before* emitting our own PAUSE below, which would otherwise make this
  // always read true and make the check below meaningless.
  const alreadyPlatformPaused = isPlatformPaused()

  game.events.emit(YTEvents.PAUSE)

  // Arbitration: unlike Settings.close(), we can't just check isPlatformPaused() again in
  // `finally` -- our own emit() above already set it to `true`, so it would always read
  // `true` there regardless of whether anything real happened, and we'd never resume.
  // Instead, watch for any *additional* PAUSE beyond our own (registered after our emit
  // completes, so it only catches later ones) -- that can only be the real SDK relay from
  // `bindPlatformEvents()`, meaning the platform is still genuinely suspended once the ad
  // closes. In that case its own real RESUME (already wired to every listener on this same
  // channel) is what should unfreeze things, not us.
  let realPauseDuringAd = false
  const onExtraPause = () => {
    realPauseDuringAd = true
  }
  game.events.on(YTEvents.PAUSE, onExtraPause)

  try {
    return await request()
  } finally {
    game.events.off(YTEvents.PAUSE, onExtraPause)

    if (!alreadyPlatformPaused && !realPauseDuringAd) {
      game.events.emit(YTEvents.RESUME)
    }
    // else: a real platform pause was already active before the ad started, or arrived
    // during it, and hasn't been matched by its own RESUME yet -- leave it to that RESUME.
  }
}

export async function showInterstitial(game: Phaser.Game): Promise<void> {
  await withAdPause(game, () => requestInterstitialAd())
}

export async function showRewarded(game: Phaser.Game, rewardId: string): Promise<boolean> {
  // The SDK's boolean (reward earned or not) is returned as-is -- withAdPause only wraps
  // the pause/resume lifecycle around it, it never inspects or alters the result.
  return withAdPause(game, () => requestRewardedAd(rewardId))
}
