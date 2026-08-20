import * as Phaser from 'phaser'
import { GameConfig } from './config'
import { waitForPlatformReady, bindPlatformEvents } from './platform/yt'
import { bindGameplayPause } from './platform/lifecycle'
import { initHealthMonitoring, getRecentErrors } from './platform/health'
import { showInterstitial, showRewarded } from './platform/adGate'
import { init as initSaveStore, bindAutosave } from './save/store'
import { init as initAudio, playSfx } from './audio/audio'
import { initLocale } from './i18n/strings'
import { applyGameTheme, DISPLAY_FONT } from './gameTheme'
import { initDisplayFont } from './ui/font'
import { setCatalog } from './shop/catalog'
import { CATALOG } from './game/economy'
import { setPressSound } from './ui/theme'
import { SFX } from './assets'

// Before new Phaser.Game(...): a synchronous throw during game construction itself
// should still land in the ring buffer/health ping, not just errors after boot.
initHealthMonitoring()

await waitForPlatformReady()
await initSaveStore()
// Must resolve before the first scene renders any t() string — a scene's create() can run
// synchronously in the same tick as Boot/Preloader (see yt.ts's gameReady()-queuing note for
// an instant/asset-less Preloader).
await initLocale()
// Same "must resolve before the first scene's create()" reason as initLocale(): a Text object
// already drawn with the fallback face does NOT repaint when the web font arrives later.
// Never throws — a missing font degrades to system sans, it doesn't block boot (see ui/font.ts).
await initDisplayFont(DISPLAY_FONT)

// Before any scene creates a widget: every ui/theme.ts factory reads the palette at creation
// time, not reactively. (config.ts's own backgroundColor doesn't go through this — it reads the
// GAME_THEME const directly, since GameConfig is evaluated at import time, before this line.)
applyGameTheme()

// Unconditional and once, like applyGameTheme() above: `Shop` reads `getCatalog()` in its own
// create(), and a price the game quotes anywhere else (the HUD's retake/power-shot buttons) is
// read from the same list, so there is exactly one place a price is written down.
setCatalog([...CATALOG])

// Every widget in the kit clicks on press, from one registration instead of ~15 call sites. Safe
// before `initAudio(game)` below: `playSfx` no-ops until the sound manager exists, and no widget
// can be pressed before the first scene runs anyway.
setPressSound(() => playSfx(SFX.ui))

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
    // Dev/debug hook: jumps to the widget stand (`scenes/UiStand.ts`). Undefined in a production
    // build, where the scene is not registered at all.
    __ui?: () => void
  }
}
window.__game = game
window.__getRecentErrors = getRecentErrors
window.__adGate = { showInterstitial, showRewarded }
if (import.meta.env.DEV) {
  window.__ui = () => {
    for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key)
    game.scene.start('UiStand')
  }
}
