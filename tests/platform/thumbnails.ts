/**
 * The three store thumbnails the Playables portal requires, rendered from the BUILT game.
 *
 * `npm run thumbs`. Not a test and it asserts nothing — it is a picture tool, like `shots.ts` beside
 * it, and it shares that file's harness so what it photographs is `dist/` rather than a dev server.
 *
 * ## The portal's three shapes, and why each is framed the way it is
 *
 * - **1:1** (min 512x512) — the board, square. A square viewport is the one shape this game cannot
 *   be photographed in directly: `computeBoardFit` binds the board to the SHORTER side, so at 1:1 the
 *   board eats the whole window and `computeHudBands` is left with an 8px strip to put the HUD in.
 *   So it is shot in portrait and CLIPPED around the board's own centre, which is also the only
 *   framing where the square is all playing field and no furniture.
 * - **5:7** (540x756 recommended) — the menu. It is the one screen carrying the game's NAME, and a
 *   tall card in a feed is a cover before it is a screenshot.
 * - **16:9** (min 1280x720) — the landscape match, side panel and all: opponent, board and the
 *   consumables in one frame, which is the closest thing to "here is the game" a still can be.
 *
 * The two board shots are taken mid-AIM, with the slingshot pulled back. The mechanic is the whole
 * pitch and a board at rest does not show it — and the aim camera pulls back while a gesture is
 * being made, which also lets the plate behind the board into the picture.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, open, startMatch, waitForSettled, DEFAULT_SAVE, type GamePage } from './harness'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'store', 'thumbnails')
mkdirSync(OUT, { recursive: true })

/**
 * Presses one of the player's discs and pulls back, leaving the slingshot on screen.
 *
 * `layout.test.ts`'s own `holdAim`, with the pull aimed UP the board rather than down: this one is
 * for looking at, and a shot pointed at the enemy reads as intent where a shot pointed at nothing
 * reads as a mistake.
 */
async function holdAim(game: GamePage): Promise<void> {
  const disc = await game.page.evaluate(() => {
    const scene = window.__game!.scene.getScene('Game') as unknown as {
      sim: { discs: { x: number; y: number; side: string; alive: boolean }[] }
    }
    const camera = window.__game!.scene.getScene('Game').cameras.main
    const mine = scene.sim.discs.filter((d) => d.side === 'player' && d.alive)
    // The middle of the rank, not an end one — a slingshot drawn from the corner of the board points
    // out of the frame.
    const d = mine[Math.floor(mine.length / 2)]
    const view = camera.worldView
    return { x: camera.x + (d.x - view.x) * camera.zoom, y: camera.y + (d.y - view.y) * camera.zoom }
  })
  await game.page.mouse.move(disc.x, disc.y)
  await game.page.mouse.down()
  // Down and a little right: the disc flies the other way, i.e. up the board at the far rank.
  await game.page.mouse.move(disc.x + 26, disc.y + 120, { steps: 12 })
  // The pull-back is a ~130ms camera tween; the frame has to be taken at the END of it.
  await game.page.waitForTimeout(700)
}

/**
 * Waits for the opponent's line to be fully typed, and returns while it is still on screen.
 *
 * Both halves are load-bearing. The line is revealed one character at a time, so a frame taken as
 * soon as it appears catches half a sentence — the first run of this file produced "Sergeant said to
 * jus". And it is not on screen for long: `ui/speechLine.ts` hides it `SPEECH_HOLD_MS` after the
 * last character, so a fixed sleep long enough to be safe is also long enough to miss it entirely,
 * which is what the second run did — a third of a 16:9 frame of empty panel.
 *
 * So: wait for text, then wait for the text to STOP GROWING, then take the picture immediately.
 */
async function waitForLine(game: GamePage): Promise<void> {
  await game.page.waitForFunction(
    () => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { speechText?: { text: string } }
      const current = scene.speechText?.text ?? ''
      const store = window as unknown as { __lastLine?: string }
      const settled = current.length > 0 && store.__lastLine === current
      store.__lastLine = current
      return settled
    },
    undefined,
    { timeout: 20_000, polling: 250 },
  )
}

/** Where the board's centre is on screen, in CSS px — the anchor a square crop is taken around. */
async function boardCentre(game: GamePage): Promise<{ x: number; y: number }> {
  return game.page.evaluate(() => {
    const scene = window.__game!.scene.getScene('Game') as unknown as {
      bands: { orientation: string; leading: { width: number; height: number } }
      fit: { boardPx: number }
    }
    const { width, height } = window.__game!.scale
    return scene.bands.orientation === 'portrait'
      ? { x: width / 2, y: scene.bands.leading.height + scene.fit.boardPx / 2 }
      : { x: scene.bands.leading.width + scene.fit.boardPx / 2, y: height / 2 }
  })
}

const harness = await launch()

// 1:1 — the board, clipped square out of a portrait window. See the header for why it cannot simply
// be shot at 1024x1024.
{
  // The crop is TIGHTER than the window: the aim camera pulls back while a gesture is being made,
  // so a square the size of the board's resting fit would frame two hands of empty plate. 860 puts
  // the board at about four fifths of the frame and still leaves room for the pull, which runs a
  // long way below the disc being pulled.
  const side = 860
  const game = await open(harness, { width: 1024, height: 1434, save: DEFAULT_SAVE })
  await startMatch(game)
  await waitForSettled(game.page)
  await holdAim(game)
  const centre = await boardCentre(game)
  await game.page.screenshot({
    path: path.join(OUT, 'thumb-1x1.png'),
    clip: { x: centre.x - side / 2, y: Math.max(0, centre.y - side / 2), width: side, height: side },
  })
  await game.page.mouse.up()
  await game.page.close()
  console.log('thumb 1:1')
}

// 5:7 — the menu, at the portal's recommended resolution.
{
  const game = await open(harness, { width: 540, height: 756, save: DEFAULT_SAVE })
  await game.page.waitForTimeout(1200)
  await game.page.screenshot({ path: path.join(OUT, 'thumb-5x7.png') })
  await game.page.close()
  console.log('thumb 5:7')
}

// 16:9 — the landscape match, side panel and all, on the opponent's opening line.
//
// Not mid-aim, unlike the square: the aim camera pulls the board back to a third of the frame, and
// this is the one shape wide enough for the empty plate beside it to show. The slingshot is the
// square's job; this one is here for the opponent, the panel and a full-size board — and it is taken
// at the greeting because `onMatchStart` is the one line that is guaranteed to be said, where a
// later one depends on the speech director's rate limit falling the right way.
{
  const game = await open(harness, { width: 1920, height: 1080, save: DEFAULT_SAVE })
  await startMatch(game)
  await waitForSettled(game.page)
  await waitForLine(game)
  await game.page.screenshot({ path: path.join(OUT, 'thumb-16x9.png') })
  await game.page.close()
  console.log('thumb 16:9')
}

await harness.close()
