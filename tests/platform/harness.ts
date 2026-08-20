/**
 * The browser-level test harness: everything `tests/platform/*.test.ts` needs to get a real canvas
 * in front of a real Chrome and ask it questions.
 *
 * **Lifted from `../Checkers/tests/platform/harness.ts`**, which `TODO.md` item 4 has been pointing
 * at for a while. What finally moved it was a bug this project shipped and a player found: the
 * rival popup opened, both of its answers did nothing, and the game could not be started at all
 * (see CLAUDE.md's note on Phaser queueing scene operations). Every check in this repo passed
 * throughout — `tsc`, 80 unit tests, `verify:*`, the bundle guard — because not one of them boots a
 * scene. A defect in the wiring BETWEEN screens is invisible to all of them by construction.
 *
 * **It runs the BUILT bundle, not the dev server.** `dist/` is the only artifact that gets
 * submitted, and until this existed nothing here ever ran it — `check-bundle.mjs` inspects the files
 * without booting them. It is also served from a SUBPATH rather than the domain root, which is where
 * Playables actually hosts a game: a regression to root-absolute asset paths (a certification
 * blocker this codebase has already hit once) fails every test here on the spot instead of surviving
 * to submission.
 *
 * **Why headless and not the Chrome extension tooling:** a background tab has `requestAnimationFrame`
 * stopped, so every check would have to hand-pump frames on a busy-wait loop — the trap recorded in
 * this project's own memory as costing a whole wrong diagnosis. A headless page is FOREGROUND: rAF
 * runs at full rate, tweens advance, and a test can simply wait for a condition.
 */
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright-core'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SAVE_STATE } from '../../src/save/types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const DIST = path.join(ROOT, 'dist')

/** The bundle is served here, not at `/`. See the module comment. */
const BASE_PATH = '/playables/flick-checkers'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

export interface Harness {
  browser: Browser
  url: string
  close(): Promise<void>
}

/** Serves `dist/` under {@link BASE_PATH} on an OS-assigned port, so parallel test files never
 * fight over one. */
function serveDist(): Promise<{ server: Server; origin: string }> {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('tests/platform needs a build: run `npm run build` first (dist/index.html is missing).')
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // Chrome asks for this on its own, at the ORIGIN root, whatever subpath the page is on. Not the
    // game's request and not the game's problem — answered with "nothing here" so it does not show
    // up as a 404 in the console-error assertions.
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204).end()
      return
    }
    if (!url.pathname.startsWith(BASE_PATH)) {
      res.writeHead(404).end('not found')
      return
    }
    const rel = url.pathname.slice(BASE_PATH.length).replace(/^\/+/, '') || 'index.html'
    const file = path.join(DIST, rel)
    // Refuse anything that escapes dist/ — a test server is still a server.
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

/**
 * One browser + one server for a whole test file. Cheap enough to do per file (Chrome starts in well
 * under a second) and keeps files independent.
 */
export async function launch(): Promise<Harness> {
  const { server, origin } = await serveDist()
  // `channel: 'chrome'` uses the Chrome already installed on the machine instead of downloading a
  // ~130 MB Playwright build — the point here is a real browser, not a pinned one.
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    // The game starts music on the menu; without this the audio context stays locked and every sound
    // assertion would be testing autoplay policy rather than the game.
    args: ['--autoplay-policy=no-user-gesture-required'],
  })

  return {
    browser,
    url: `${origin}${BASE_PATH}/index.html`,
    async close() {
      await browser.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

export interface OpenOptions {
  width: number
  height: number
  /**
   * Written into `localStorage` BEFORE any app code runs, so the game boots with it. Seeding it
   * after load and reloading does not work: the outgoing page's `pagehide` autosave flush overwrites
   * the seed with whatever was in memory.
   *
   * Applied to the FIRST load only (guarded by a `sessionStorage` flag, which survives a reload in
   * the same tab). A reload therefore sees what the GAME saved, not what the test seeded — which is
   * the whole point of any reload test.
   */
  save?: Record<string, unknown>
}

export interface GamePage {
  page: Page
  /** Every console message the page produced, in order. */
  logs: string[]
  errors: string[]
  waitForScene(key: string): Promise<void>
  /** Clicks in CSS pixels on the canvas, which fills the viewport 1:1. */
  click(x: number, y: number): Promise<void>
}

/** The shipped defaults with a purse, which is what most fixtures want — imported rather than
 * retyped, so a field added to `SaveState` cannot leave this file describing an older game. */
export const DEFAULT_SAVE = { ...DEFAULT_SAVE_STATE, coins: 500 }

/** Opens the game at a viewport size and waits until the menu is up. */
export async function open(harness: Harness, options: OpenOptions): Promise<GamePage> {
  const page = await harness.browser.newPage({ viewport: { width: options.width, height: options.height } })

  const logs: string[] = []
  const errors: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    logs.push(`${message.type()}: ${message.text()}`)
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))

  if (options.save) {
    const json = JSON.stringify(options.save)
    await page.addInitScript((data: string) => {
      if (window.sessionStorage.getItem('test-save-seeded')) return
      window.sessionStorage.setItem('test-save-seeded', '1')
      window.localStorage.setItem('SAVE_DATA', data)
    }, json)
  }

  await page.goto(harness.url)
  await page.waitForFunction(() => Boolean(window.__game))
  await waitForScene(page, 'MainMenu')

  return {
    page,
    logs,
    errors,
    waitForScene: (key: string) => waitForScene(page, key),
    click: async (x: number, y: number) => {
      await page.mouse.click(x, y)
    },
  }
}

export function waitForScene(page: Page, key: string): Promise<void> {
  return page
    .waitForFunction((sceneKey: string) => Boolean(window.__game?.scene.getScene(sceneKey)?.scene.isActive()), key, { timeout: 15_000 })
    .then(() => undefined)
}

/**
 * The screen position of a named `GameButton` on a scene, in CSS pixels.
 *
 * **Through `getWorldTransformMatrix`, never `container.x`.** Half the buttons in this game live
 * inside an overlay's panel Container, so their own coordinates are panel-LOCAL and clicking them
 * would land wherever the panel happens to sit relative to the origin. The matrix walks the parents
 * for us and gives the same answer for a scene-level button, so callers need not know which kind
 * they are pointing at.
 */
export async function buttonAt(page: Page, sceneKey: string, field: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ key, name }) => {
      const scene = window.__game!.scene.getScene(key) as unknown as Record<string, { container: Phaser.GameObjects.Container } | undefined>
      const button = scene[name]
      if (!button) throw new Error(`${key} has no button field "${name}"`)
      const m = button.container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    },
    { key: sceneKey, name: field },
  )
}

/**
 * Waits for an overlay scene's panel to finish springing in.
 *
 * A timeout would work and is what the project this came from used; polling the panel's own scale is
 * better for the same reason every wait here is a condition rather than a sleep — it cannot pass
 * early on a slow machine or waste 300ms on a fast one. Reading a `private` field from the page is
 * fine: TypeScript's `private` is erased, and this is a test.
 */
export async function waitForOverlay(page: Page, sceneKey: string): Promise<void> {
  await page.waitForFunction(
    (key: string) => {
      const scene = window.__game?.scene.getScene(key) as unknown as { overlay?: { panel: { scaleX: number } } } | undefined
      return Boolean(scene?.overlay && scene.overlay.panel.scaleX > 0.999)
    },
    sceneKey,
    { timeout: 10_000 },
  )
}

export interface StartOptions {
  /** Take the "play a friend" answer at the rival question instead of the character gallery. */
  twoPlayer?: boolean
}

/**
 * Starts a match through the real menus, and waits until the board exists.
 *
 * **Every step is a click, not a `scene.start`.** The wiring between screens is exactly what has no
 * other coverage in this repo — the bug that prompted the whole harness was a callback that fired
 * and then bailed out on a stale flag, which every form of static checking is blind to. A helper
 * that jumped straight to `Game` would have reproduced the blindness.
 *
 * Four taps against a character (menu, mode, rival, gallery) and three against a friend.
 */
export async function startMatch(game: GamePage, options: StartOptions = {}): Promise<void> {
  const menu = await buttonAt(game.page, 'MainMenu', 'newMatchButton')
  await game.click(menu.x, menu.y)
  await game.waitForScene('Modes')

  const start = await buttonAt(game.page, 'Modes', 'startButton')
  await game.click(start.x, start.y)

  // The rival question. Its answers are a list, so they are read by index: 0 is the character, 1 the
  // friend, 2 the cancel — the order `Modes.askRival()` builds them in.
  await game.waitForScene('Confirm')
  await waitForOverlay(game.page, 'Confirm')
  const answer = await game.page.evaluate((index: number) => {
    const scene = window.__game!.scene.getScene('Confirm') as unknown as { buttons: { container: Phaser.GameObjects.Container }[] }
    const m = scene.buttons[index].container.getWorldTransformMatrix()
    return { x: m.tx, y: m.ty }
  }, options.twoPlayer ? 1 : 0)
  await game.click(answer.x, answer.y)

  if (!options.twoPlayer) {
    await game.waitForScene('Opponents')
    await waitForOverlay(game.page, 'Opponents')
    const go = await buttonAt(game.page, 'Opponents', 'startButton')
    await game.click(go.x, go.y)
  }

  await game.waitForScene('Game')
  await game.page.waitForFunction(() => Boolean((window.__game!.scene.getScene('Game') as unknown as { board?: unknown }).board))
}

/**
 * Waits until the board is still and a round is in progress — i.e. the scene will accept an aim.
 *
 * Polling for it is what replaces the hand-pumped frame loop the extension-driven checks needed. It
 * deliberately does NOT wait for a particular side: in a two-player match both sides are a person,
 * and a helper that waited for `'player'` would hang for half of every round.
 */
export async function waitForSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const scene = window.__game?.scene.getScene('Game') as unknown as
        | { sim?: { discs: { alive: boolean; vx: number; vy: number }[] }; round?: { winner: string | null } }
        | undefined
      if (!scene?.sim || !scene.round) return false
      if (scene.round.winner) return true
      return !scene.sim.discs.some((disc) => disc.alive && (disc.vx !== 0 || disc.vy !== 0))
    },
    undefined,
    { timeout: 30_000 },
  )
}

declare global {
  interface Window {
    __game?: import('phaser').Game
  }
}
