import * as Phaser from 'phaser'
import { GAME_THEME } from './gameTheme'
import { toCssColor } from './ui/theme'
import { Boot } from './scenes/Boot'
import { Preloader } from './scenes/Preloader'
import { MainMenu } from './scenes/MainMenu'
import { Daily } from './scenes/Daily'
import { DailyResult } from './scenes/DailyResult'
import { Game } from './scenes/Game'
import { MatchResult } from './scenes/MatchResult'
import { Modes } from './scenes/Modes'
import { Opponents } from './scenes/Opponents'
import { Settings } from './scenes/Settings'
import { Confirm } from './scenes/Confirm'
import { Shop } from './scenes/Shop'
import { UiStand } from './scenes/UiStand'

export const GameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  // The canvas clear color, visible for the frames before any scene draws its own background —
  // must be the theme's own top gradient stop, or the template's default blue flashes on boot.
  // Read from the plain GAME_THEME const rather than getTheme(): this object is evaluated at
  // module-import time, before main.ts's applyGameTheme() call runs (see gameTheme.ts).
  backgroundColor: toCssColor(GAME_THEME.colors.backgroundTop),
  scale: {
    parent: 'app',
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  input: {
    // Two simultaneous touch pointers. The aim drag needs exactly one, and there is no pan gesture
    // to share the screen with (`board/layout.ts`: the board always fits whole) — but a stray
    // second finger still has to be SEEN to be ignored, and Phaser starts a single touch pointer
    // by default, which would report a two-finger fumble as a clean one-finger drag.
    activePointers: 2,
  },
  // NO PHYSICS. Arcade was in the draughts config and CHAPAEV-PLAN.md §2 removes it deliberately —
  // this game runs its own solver in `src/sim/`, and the reasons are all disqualifying rather than
  // preferences:
  //   1. Tunnelling. A flick reaches ~15 cells/s; at 60Hz that is ~0.25 cells per frame against a
  //      ~0.4-cell radius, so Arcade steps through a contact on exactly the hardest shots — the
  //      ones the game exists for. The sim runs a fixed 1/240s step instead.
  //   2. Arcade separates along AABB axes. Carrom needs a true elastic exchange along the line of
  //      centres between two discs, which is the entire mechanic, not a refinement of it.
  //   3. Determinism. A pure, Phaser-free solver gives the bot (§6), the daily puzzle generator
  //      with its solvability proof (§7), replays, and `node`-run tests — all for free.
  // `UiStand` is the widget stand and is DEV ONLY — reached with `window.__ui()`, never navigated
  // to by the game. The conditional is what keeps it out of the shipped bundle: Vite substitutes
  // `import.meta.env.DEV` with `false` in a production build and Rollup drops the branch and, with
  // it, the only reference to the import.
  scene: [Boot, Preloader, MainMenu, Game, Daily, DailyResult, MatchResult, Modes, Opponents, Settings, Shop, Confirm, ...(import.meta.env.DEV ? [UiStand] : [])],
}
