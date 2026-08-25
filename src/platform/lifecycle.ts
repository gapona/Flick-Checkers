import * as Phaser from 'phaser'
import { YTEvents } from './yt'

/**
 * Scenes explicitly excluded from platform-pause freezing — an *overlay* list, not a
 * gameplay whitelist. `bindGameplayPause()` below pauses every currently active scene
 * except these, so a new gameplay scene added later is frozen by default without anyone
 * needing to remember to register it; only new *overlay* scenes (menus/dialogs meant to
 * stay interactive during a pause, like `Settings` and `Shop`) need to be added here.
 */
// Shop and Modes LEFT this set when they became bottom-navigation destinations rather than
// launched overlays: they are ordinary scenes now, and a platform pause should freeze them like any
// other. What remains is what is genuinely launched over something else and must keep its own close
// button alive through a pause — otherwise the player is stuck behind a dialog they cannot dismiss.
const OVERLAY_SCENES = new Set(['Settings', 'MatchResult', 'DailyResult', 'Confirm', 'Opponents', 'Coach'])

/**
 * Raises a launched overlay above every other scene, so what it draws is actually seen.
 *
 * **This exists because of a shipped bug that made four screens unusable, and the cause is one every
 * Phaser project meets exactly once.** `SceneManager.render()` walks `this.scenes` in FORWARD array
 * order, which is the order `config.ts` registers them in — and `scene.launch()` does not touch that
 * order. `Settings` sits at index 9 of that list; `Shop`, `Confirm`, `Tutorial`, `HowToPlay` and
 * `Coach` all sit after it. So opening the settings panel from the shop, the tutorial or the rules
 * page ran perfectly: the scene started, it paused its opener, it drew its panel — UNDERNEATH the
 * opaque page that had launched it. From the outside the gear was a dead button, and the screen it
 * was on was now frozen behind an invisible dialog. It was reported three separate ways
 * ("при нажатии на настройки ничо не происходит"), and the tutorial's own Finish button — which
 * raises `Confirm`, one index below `Tutorial` — was the fourth.
 *
 * **A scene's position in the registration array is a RENDERING decision, and no caller should have
 * to know it.** Reordering `config.ts` would fix today's list and break silently the next time a
 * screen is appended after an overlay, which is the natural place to append one. So the overlay
 * asserts its own depth on the way up instead, from the same module that already owns the list of
 * what an overlay IS — the two facts cannot drift apart when they are written down once.
 *
 * Safe to call unconditionally: `bringToTop` is idempotent, and the manager queues it when it is
 * mid-pass rather than mutating the array it is iterating.
 */
export function raiseOverlay(scene: Phaser.Scene): void {
  scene.scene.bringToTop()
}

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
