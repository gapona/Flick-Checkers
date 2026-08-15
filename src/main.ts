import * as Phaser from 'phaser'
import { GameConfig } from './config'
import { waitForPlatformReady, bindPlatformEvents } from './platform/yt'
import { bindGameplayPause } from './platform/lifecycle'
import { initHealthMonitoring, getRecentErrors } from './platform/health'
import { showInterstitial, showRewarded } from './platform/adGate'
import { init as initSaveStore, bindAutosave } from './save/store'
import { init as initAudio } from './audio/audio'
import { initLocale } from './i18n/strings'

// Before new Phaser.Game(...): a synchronous throw during game construction itself
// should still land in the ring buffer/health ping, not just errors after boot.
initHealthMonitoring()

await waitForPlatformReady()
await initSaveStore()
// Must resolve before the first scene renders any t() string — a scene's create() can run
// synchronously in the same tick as Boot/Preloader (see yt.ts's gameReady()-queuing note for
// an instant/asset-less Preloader).
await initLocale()

const game = new Phaser.Game(GameConfig)
bindPlatformEvents(game)
bindGameplayPause(game)
bindAutosave(game)
initAudio(game)

declare global {
  interface Window {
    // Dev/debug hook: lets manual testing emit platform events (YTEvents.PAUSE/RESUME/
    // AUDIO_ENABLED_CHANGE) on game.events without a real ytgame SDK to drive them.
    __game?: Phaser.Game
    // Dev/debug hook: exposes health.ts's ring buffer for the dev console and tests --
    // a raw dynamic import() from a test script resolves to a different module instance
    // than the one initHealthMonitoring() above wired up (see CLAUDE.md's "dual module
    // instance" gotcha), so this is the only reliable way to inspect the live one.
    __getRecentErrors?: typeof getRecentErrors
    // Dev/debug hook: exposes adGate.ts's functions bound to this page's actual yt.ts
    // instance (same dual-module-instance reason as above -- adGate's isPlatformPaused()
    // check would read from a disconnected, always-false state on a freshly re-imported
    // yt.ts instance otherwise).
    __adGate?: { showInterstitial: typeof showInterstitial; showRewarded: typeof showRewarded }
  }
}
window.__game = game
window.__getRecentErrors = getRecentErrors
window.__adGate = { showInterstitial, showRewarded }
