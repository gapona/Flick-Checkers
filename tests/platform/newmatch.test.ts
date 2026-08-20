import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { DEFAULT_SAVE, launch, open, startMatch, waitForOverlay, waitForSettled, type GamePage, type Harness } from './harness'

/**
 * Getting from the menu into a match, both ways.
 *
 * **This file exists because of a bug it would have caught.** `Modes.askRival()` raises the rival
 * question, and both of its answers began by checking a `leaving` flag that a `RESUME` listener was
 * supposed to have cleared — except Phaser QUEUES scene operations, so the resume had only been
 * requested, the listener had not run, and both answers bailed out. The popup closed and nothing
 * happened: the game could not be started at all. `tsc` was clean, 80 unit tests passed, every
 * `verify:*` passed and the bundle guard passed, because not one of them boots a scene.
 *
 * So the rule for anything added here: **click what a player clicks.** A test that reached `Game`
 * with `scene.start` would have been just as blind as everything else in the repo.
 */
describe('starting a match', () => {
  let harness: Harness

  before(async () => {
    harness = await launch()
  })
  after(async () => {
    await harness.close()
  })

  const openGame = (): Promise<GamePage> => open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })

  it('boots to the menu with nothing on the console', async () => {
    const game = await openGame()
    // Not "no errors ever" — the SDK is absent outside Playables and says so — but nothing that
    // looks like a real failure. A 404 here would mean the subpath serving caught an absolute path.
    const real = game.errors.filter((e) => !/ytgame|SDK/i.test(e))
    assert.deepEqual(real, [], `unexpected console errors:\n${real.join('\n')}`)
    await game.page.close()
  })

  it(`the daily button names the puzzle day, in UTC`, async () => {
    const game = await openGame()

    const label = await game.page.evaluate(
      () => (window.__game!.scene.getScene('MainMenu') as unknown as { dailyButton: { text: string } }).dailyButton.text,
    )

    /**
     * The DAY NUMBER has to be the UTC one, not the device's.
     *
     * `daily/puzzle.ts` turns the day over at midnight UTC so two players in different zones are
     * never on different puzzles, so anybody far enough east or west has a window every night where
     * a locally-formatted label names one day and the button opens another. The test machine was in
     * exactly that window when this was written — local 20 August, UTC 19 — which is why the check
     * compares against `toISOString` rather than against anything local.
     */
    const utcDay = String(new Date().toISOString().slice(8, 10)).replace(/^0/, '')
    assert.ok(label.includes(utcDay), `the daily button says "${label}", which does not name UTC day ${utcDay}`)
    await game.page.close()
  })

  it('a button click makes a sound', async () => {
    const game = await openGame()

    /**
     * **The whole game was silent and nothing said so.** `setPressSound` was registered in
     * `main.ts`, documented, and called by the three widgets in `ui/theme.ts` — none of which this
     * game uses. Every screen is built from `ui/button.ts`'s `gameButton`, which never called it. A
     * click that exists in the docs and not in the ear is exactly the kind of thing no unit test
     * looks for, so it gets one here.
     */
    await game.page.evaluate(() => {
      const played: string[] = []
      ;(window as unknown as { __played: string[] }).__played = played
      const manager = window.__game!.sound as unknown as { play(key: string, config?: unknown): boolean }
      const original = manager.play.bind(manager)
      manager.play = (key: string, config?: unknown) => {
        played.push(key)
        return original(key, config)
      }
    })

    const at = await game.page.evaluate(() => {
      const menu = window.__game!.scene.getScene('MainMenu') as unknown as { newMatchButton: { container: Phaser.GameObjects.Container } }
      const m = menu.newMatchButton.container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(at.x, at.y)
    await game.page.waitForTimeout(200)

    const played = await game.page.evaluate(() => (window as unknown as { __played: string[] }).__played)
    assert.ok(played.length > 0, 'pressing a button played nothing at all')
    await game.page.close()
  })

  it('the mode screen asks WHO before it shows anybody', async () => {
    const game = await openGame()

    const menu = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('MainMenu') as unknown as { newMatchButton: { container: Phaser.GameObjects.Container } }
      const m = scene.newMatchButton.container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(menu.x, menu.y)
    await game.waitForScene('Modes')

    // Tapping a MODE card must not open anything — a card is a choice and the button is the act.
    const card = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Modes') as unknown as { cards: { hit: Phaser.GameObjects.Rectangle }[] }
      const m = scene.cards[1].hit.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(card.x, card.y)
    await game.page.waitForTimeout(300)
    const openedOnTap = await game.page.evaluate(() =>
      ['Confirm', 'Opponents'].some((key) => Boolean(window.__game!.scene.getScene(key)?.scene.isActive())),
    )
    assert.equal(openedOnTap, false, 'tapping a mode card should select it and nothing else')

    const start = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Modes') as unknown as { startButton: { container: Phaser.GameObjects.Container } }
      const m = scene.startButton.container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(start.x, start.y)
    await game.waitForScene('Confirm')
    await waitForOverlay(game.page, 'Confirm')

    const answers = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Confirm') as unknown as { buttons: { container: Phaser.GameObjects.Container }[] }
      return scene.buttons.length
    })
    assert.equal(answers, 3, 'a character, a friend, and a way out')
    await game.page.close()
  })

  it('the character answer reaches a board', async () => {
    const game = await openGame()
    await startMatch(game)

    const state = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { twoPlayer: boolean; sim: { discs: unknown[] } }
      return { twoPlayer: scene.twoPlayer, discs: scene.sim.discs.length }
    })
    assert.equal(state.twoPlayer, false)
    assert.equal(state.discs, 16, 'eight a side')
    await game.page.close()
  })

  it('the friend answer reaches a board, and skips the gallery entirely', async () => {
    const game = await openGame()
    await startMatch(game, { twoPlayer: true })

    const state = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { twoPlayer: boolean; sim: { discs: unknown[] } }
      return {
        twoPlayer: scene.twoPlayer,
        discs: scene.sim.discs.length,
        galleryRan: Boolean(window.__game!.scene.getScene('Opponents')?.scene.isActive()),
      }
    })
    assert.equal(state.twoPlayer, true)
    assert.equal(state.discs, 16)
    assert.equal(state.galleryRan, false, 'a hot-seat match has no character to pick')
    await game.page.close()
  })

  it('nobody plays for the second seat', async () => {
    const game = await openGame()
    await startMatch(game, { twoPlayer: true })
    await waitForSettled(game.page)

    /**
     * The whole of the mode, as one assertion: hand the turn to the opponent's side and check that
     * it is still sitting there a second later. In a solo match the bot would have taken it — the
     * search is ~0.2s of work and the scene pumps it every frame.
     */
    await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { round: { turn: string } }
      scene.round.turn = 'opponent'
    })
    await game.page.waitForTimeout(1200)
    const after = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { round: { turn: string; shots: number } }
      return { turn: scene.round.turn, shots: scene.round.shots }
    })
    assert.equal(after.turn, 'opponent', 'the bot must not take a shot in a two-player match')
    assert.equal(after.shots, 0)
    await game.page.close()
  })

  it('cancelling the question puts the player back on the mode screen', async () => {
    const game = await openGame()

    const menu = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('MainMenu') as unknown as { newMatchButton: { container: Phaser.GameObjects.Container } }
      const m = scene.newMatchButton.container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(menu.x, menu.y)
    await game.waitForScene('Modes')

    const start = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Modes') as unknown as { startButton: { container: Phaser.GameObjects.Container } }
      const m = scene.startButton.container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(start.x, start.y)
    await game.waitForScene('Confirm')
    await waitForOverlay(game.page, 'Confirm')

    const cancel = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Confirm') as unknown as { buttons: { container: Phaser.GameObjects.Container }[] }
      const m = scene.buttons[2].container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(cancel.x, cancel.y)

    // And crucially it must be usable again afterwards — the shipped bug left a guard set, so the
    // second attempt behaved differently from the first.
    await game.page.waitForFunction(() => window.__game!.scene.getScene('Modes')!.scene.isActive() && !window.__game!.scene.getScene('Confirm')?.scene.isActive())
    await game.click(start.x, start.y)
    await game.waitForScene('Confirm')
    await game.page.close()
  })
})
