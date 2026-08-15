import * as Phaser from 'phaser'
import { YTEvents } from './yt'

/**
 * Scenes explicitly excluded from platform-pause freezing — an *overlay* list, not a
 * gameplay whitelist. `bindGameplayPause()` below pauses every currently active scene
 * except these, so a new gameplay scene added later is frozen by default without anyone
 * needing to remember to register it; only new *overlay* scenes (menus/dialogs meant to
 * stay interactive during a pause, like `Settings` and `Shop`) need to be added here.
 */
const OVERLAY_SCENES = new Set(['Settings', 'Shop'])

/**
 * Freezes gameplay on `YTEvents.PAUSE` and unfreezes it on `YTEvents.RESUME` — the
 * certification requirement this was missing: `audio.ts` mutes/stops sound and
 * `store.ts` flushes the save on a platform pause, but until this module nothing ever
 * called `scene.pause()`, so `Game`'s (and `MainMenu`'s) `update()` loop kept running
 * underneath.
 *
 * Arbitrates with an open overlay's own pause/resume ownership (see `Settings.close()`/
 * `Shop.close()`) rather than fighting it: `game.scene.getScenes(true)` only returns scenes
 * that are currently *running* — a scene already paused because an overlay is open over it
 * isn't in that list, so the loop below skips it on `PAUSE` (nothing to do, it's already
 * frozen) and, on `RESUME`, this module only resumes scenes it *itself* paused, and never
 * while any `OVERLAY_SCENES` member is still open. Each overlay's own `close()` already
 * checks `isPlatformPaused()` and defers its own resume to the next `YTEvents.RESUME` if
 * needed — that logic is untouched by this module; the two only ever act on a given scene
 * at mutually exclusive times, so there's no double-resume race. This check is driven off
 * `OVERLAY_SCENES` itself (not one hardcoded scene key) so a new overlay added to that set
 * is automatically covered here too — no second place to remember.
 *
 * Every `OVERLAY_SCENES` member is deliberately never paused here: its Close button must
 * stay clickable during a platform pause so its own deferred-resume flow can run (closing
 * an overlay *while* platform-paused is the scenario that logic exists for).
 */
export function bindGameplayPause(game: Phaser.Game): void {
  const pausedByPlatform = new Set<string>()

  game.events.on(YTEvents.PAUSE, () => {
    for (const scene of game.scene.getScenes(true)) {
      const key = scene.scene.key
      if (OVERLAY_SCENES.has(key)) continue
      game.scene.pause(key)
      pausedByPlatform.add(key)
    }
  })

  game.events.on(YTEvents.RESUME, () => {
    if (pausedByPlatform.size === 0) return

    // An overlay (Settings, Shop, ...) is still open over whatever we paused -- it owns
    // the resume now (via its own isPlatformPaused() check on close), not us.
    const overlayStillOpen = [...OVERLAY_SCENES].some((key) => game.scene.isActive(key))
    if (!overlayStillOpen) {
      for (const key of pausedByPlatform) {
        game.scene.resume(key)
      }
    }
    pausedByPlatform.clear()
  })
}
