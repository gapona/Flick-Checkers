import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { buttonAt, DEFAULT_SAVE, launch, open, startMatch, waitForOverlay, waitForScene, type GamePage, type Harness } from './harness'

/**
 * Four defects a player found in one sitting, each reproduced here so it cannot come back.
 *
 * Three of them are one bug. `SceneManager.render()` walks its scene array in FORWARD order and
 * `scene.launch()` never reorders it, so an overlay registered EARLIER in `config.ts` than the page
 * that launches it is drawn underneath that page. `Settings` sits before `Shop`, `Tutorial` and
 * `HowToPlay`; `Confirm` sits before `Tutorial`. The panels all opened, paused their opener and drew
 * themselves behind an opaque background — so the gear was a dead button on three screens and the
 * tutorial's own Finish button was a fourth, each one leaving the screen it was pressed on frozen
 * behind a dialog nobody could see. `platform/lifecycle.ts`'s `raiseOverlay` is the fix.
 *
 * **The assertion is the scene ORDER, not a screenshot.** A screenshot proves the panel is visible
 * today; the order is the property that makes it visible for every overlay, including one added
 * after this file was written. `layout.test.ts` already owns the pixels.
 *
 * The rest are the aim camera, which could be left zoomed out for the whole of a round, and two
 * pieces of the HUD that are sized from their own content and were never re-placed when it changed.
 */
describe('overlays and the board camera', () => {
  let harness: Harness
  before(async () => {
    harness = await launch()
  })
  after(async () => {
    await harness.close()
  })

  /** Where each scene sits in the manager's render order. Last is on top. */
  function sceneOrder(game: GamePage): Promise<string[]> {
    return game.page.evaluate(() => window.__game!.scene.scenes.map((scene) => scene.scene.key))
  }

  async function pressGear(game: GamePage, sceneKey: string): Promise<void> {
    const at = await game.page.evaluate((key: string) => {
      const scene = window.__game!.scene.getScene(key) as unknown as {
        topBar: { parts(): { settings: { x: number; y: number; width: number; height: number } } }
      }
      const box = scene.topBar.parts().settings
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }, sceneKey)
    await game.click(at.x, at.y)
  }

  for (const page of ['Shop', 'HowToPlay', 'Tutorial'] as const) {
    it(`draws Settings above ${page}, which is registered after it`, async () => {
      const game = await open(harness, { width: 360, height: 640, save: DEFAULT_SAVE })
      await game.page.evaluate((key: string) => window.__game!.scene.getScene('MainMenu').scene.start(key), page)
      await waitForScene(game.page, page)
      await game.page.waitForTimeout(400)

      await pressGear(game, page)
      await waitForScene(game.page, 'Settings')

      const order = await sceneOrder(game)
      assert.equal(order.at(-1), 'Settings', `Settings must render last, got ${order.slice(-3).join(' > ')}`)
      assert.ok(order.indexOf('Settings') > order.indexOf(page), `Settings is below ${page} in the render order`)
      await game.page.close()
    })
  }

  it('the tutorial ending panel is actually on screen', async () => {
    const game = await open(harness, { width: 360, height: 640, save: DEFAULT_SAVE })
    await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu').scene.start('Tutorial'))
    await waitForScene(game.page, 'Tutorial')
    await game.page.waitForTimeout(400)

    // Straight to the last lesson: the six-lesson walk is `tutorial.test.ts`'s job, and what is
    // under test here is the ONE button that raises `Confirm`.
    await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Tutorial') as unknown as { loadLesson(index: number): void }
      scene.loadLesson(5)
    })
    await game.page.waitForTimeout(300)
    const button = await buttonAt(game.page, 'Tutorial', 'actionButton')
    await game.click(button.x, button.y)

    await waitForScene(game.page, 'Confirm')
    const order = await sceneOrder(game)
    assert.equal(order.at(-1), 'Confirm', `the ending panel must render last, got ${order.slice(-3).join(' > ')}`)
    await game.page.close()
  })

  /**
   * The two aim-camera moves are tweens, and a tween writes nothing at the moment it is created.
   * `leaveAimCamera` compared the camera's CURRENT zoom against the resting fit, so a press and a
   * second finger inside one input tick read a camera that had not moved yet, concluded there was
   * nothing to undo, and left the zoom-out tween running unopposed. Reported as "I swiped with a
   * finger and the board shrank".
   *
   * Driven through the scene's own two methods rather than through two synthetic touch points: what
   * is under test is the guard, and `bindDrag`'s second-finger path calls exactly these.
   */
  it('a gesture cancelled in the same tick it began leaves the board at full size', async () => {
    const game = await open(harness, { width: 360, height: 640, save: DEFAULT_SAVE })
    await startMatch(game, { twoPlayer: true })
    await game.page.waitForTimeout(600)

    const resting = await game.page.evaluate(() => window.__game!.scene.getScene('Game').cameras.main.zoom)

    await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as {
        sim: { discs: { alive: boolean }[] }
        aiming: unknown
        enterAimCamera(): void
        cancelAim(): void
      }
      scene.aiming = scene.sim.discs.find((disc) => disc.alive)
      scene.enterAimCamera()
      scene.cancelAim()
    })
    await game.page.waitForTimeout(500)

    const after = await game.page.evaluate(() => window.__game!.scene.getScene('Game').cameras.main.zoom)
    assert.equal(after, resting, 'the board stayed zoomed out after a cancelled gesture')
    await game.page.close()
  })

  /**
   * The lessons build on each other — lesson three's punchline only lands if you remember lesson
   * two's reach — and until this there was no way back to one you had walked past. Reported in the
   * same session and the same words as the guided tour's missing Back.
   */
  it('the tutorial steps back a lesson, and cannot step off the first', async () => {
    const game = await open(harness, { width: 360, height: 640, save: DEFAULT_SAVE })
    await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu').scene.start('Tutorial'))
    await waitForScene(game.page, 'Tutorial')
    await game.page.waitForTimeout(400)

    const lesson = () => game.page.evaluate(() => (window.__game!.scene.getScene('Tutorial') as unknown as { index: number }).index)
    const back = () => buttonAt(game.page, 'Tutorial', 'backButton')

    assert.equal(await lesson(), 0)
    const first = await back()
    await game.click(first.x, first.y)
    await game.page.waitForTimeout(250)
    assert.equal(await lesson(), 0, 'Back on the first lesson moved somewhere')

    const skip = await buttonAt(game.page, 'Tutorial', 'actionButton')
    await game.click(skip.x, skip.y)
    await game.page.waitForTimeout(300)
    assert.equal(await lesson(), 1)

    const second = await back()
    await game.click(second.x, second.y)
    await game.page.waitForTimeout(300)
    assert.equal(await lesson(), 0, 'Back did not return to the previous lesson')
    await game.page.close()
  })

  /**
   * The daily is a one-shot puzzle with an unlimited retry, which in practice is a search — and a
   * search with no feedback between attempts is flailing. Asked for by a player after, by their own
   * account, a great many attempts. The hint shows the DIRECTION of a solving shot and never the
   * power, and it is re-derived from the generator's own candidate list rather than shipped in the
   * catalogue.
   */
  it('the daily offers a direction after enough misses, and not before', async () => {
    const game = await open(harness, { width: 360, height: 640, save: DEFAULT_SAVE })
    await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu').scene.start('Daily'))
    await waitForScene(game.page, 'Daily')
    await game.page.waitForTimeout(500)

    const offered = () =>
      game.page.evaluate(
        () => (window.__game!.scene.getScene('Daily') as unknown as { hintButton: { container: { visible: boolean } } }).hintButton.container.visible,
      )
    assert.equal(await offered(), false, 'the hint was offered before a single attempt')

    const found = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Daily') as unknown as {
        attempts: number
        hint: { discId: number; angle: number; power: number } | null
        refreshHintButton(): void
        showHint(): void
      }
      scene.attempts = 3
      scene.refreshHintButton()
      scene.showHint()
      return scene.hint
    })
    assert.equal(await offered(), true, 'the hint was still hidden after three misses')
    assert.ok(found, "today's puzzle has no solution the generator's own search can find")
    await game.page.close()
  })

  /**
   * Retry gives the SAME puzzle back.
   *
   * A certification rejection this game has not got but is one line away from: a daily whose Retry
   * hands the player a different board is a daily nobody can be said to have solved, and it is the
   * kind of thing that only shows up when somebody loses on purpose and looks twice. `reset()`
   * rebuilds from the same `record` this scene looked up once for today, and `pristine` is a clone
   * rather than a regeneration — this walks the real path (a real losing shot, the real result panel,
   * a real click on Retry) and compares the boards disc for disc.
   */
  it('the daily gives the same puzzle back on Retry', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu').scene.start('Daily'))
    await waitForScene(game.page, 'Daily')
    await game.page.waitForTimeout(600)

    const board = () =>
      game.page.evaluate(() => {
        const scene = window.__game!.scene.getScene('Daily') as unknown as {
          today: string
          sim: { discs: { id: number; side: string; x: number; y: number; alive: boolean }[] }
        }
        return {
          today: scene.today,
          discs: scene.sim.discs.map((d) => `${d.side}:${d.x.toFixed(2)},${d.y.toFixed(2)}`).join(' | '),
        }
      })

    const before = await board()

    // A real shot, and a bad one: straight down the board, away from every target.
    await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Daily') as unknown as {
        sim: { discs: { id: number; side: string; alive: boolean; vx: number; vy: number }[] }
        shotOutcome: unknown
        attempts: number
      }
      const disc = scene.sim.discs.find((d) => d.side === 'player' && d.alive)!
      scene.attempts = 1
      scene.shotOutcome = {
        shooterId: disc.id,
        shooterSide: 'player',
        steps: 0,
        elapsed: 0,
        timedOut: false,
        impacts: [],
        knockedOff: [],
        splits: [],
        touchedEnemy: false,
      }
      disc.vx = 0
      disc.vy = 240
    })

    // The shot, the settle, and the 700ms the result panel waits so the discs can finish falling.
    await waitForScene(game.page, 'DailyResult')
    await waitForOverlay(game.page, 'DailyResult')

    const retry = await buttonAt(game.page, 'DailyResult', 'primaryButton')
    await game.click(retry.x, retry.y)
    await waitForScene(game.page, 'Daily')
    await game.page.waitForTimeout(600)

    const after = await board()
    assert.equal(after.today, before.today, 'the day itself must not have moved under the test')
    assert.equal(after.discs, before.discs, 'Retry must put the same puzzle back, disc for disc')
    await game.page.close()
  })

  /**
   * Both readouts in the top bar are sized from their own content and neither was re-placed when
   * that content changed: the balance plate kept the width it was drawn at, and the round pill was
   * centred while its `Text` was still EMPTY, so it grew symmetrically out of that centre and across
   * the badge's right border once a balance reached four digits. Reported as "налазит".
   */
  it('the round pill clears the coin badge at a four-digit balance', async () => {
    const game = await open(harness, { width: 360, height: 640, save: { ...DEFAULT_SAVE, coins: 2325 } })
    await startMatch(game, { twoPlayer: true })
    await game.page.waitForTimeout(600)

    const bar = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as {
        topBar: { parts(): { balance: { right: number } | null }; objects: Phaser.GameObjects.GameObject[] }
      }
      const isRound = (object: Phaser.GameObjects.GameObject): boolean =>
        object.type === 'Text' && (object as Phaser.GameObjects.Text).text.includes(' / ')
      const round = scene.topBar.objects.find(isRound) as Phaser.GameObjects.Text | undefined
      return { badgeRight: scene.topBar.parts().balance?.right ?? 0, roundLeft: round?.getBounds().x ?? 0 }
    })

    assert.ok(bar.roundLeft > bar.badgeRight, `round pill starts at ${bar.roundLeft}, badge ends at ${bar.badgeRight}`)
    await game.page.close()
  })

  /**
   * Two people at one board have no third face to look at, so the portrait is hidden — and it used
   * to keep its column in the layout anyway, which centred the status capsule on what was LEFT of
   * the band and put it 25px right of the board's own centre line. Reported as "не по центру", and
   * the report is about the capsule: the board was centred all along.
   */
  it('the hot-seat status capsule is centred, with no portrait column reserved', async () => {
    const game = await open(harness, { width: 360, height: 640, save: DEFAULT_SAVE })
    await startMatch(game, { twoPlayer: true })
    await game.page.waitForTimeout(600)

    const measured = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { statusText: Phaser.GameObjects.Text }
      return { centre: scene.statusText.getBounds().centerX, screen: window.__game!.scale.width / 2 }
    })
    assert.ok(
      Math.abs(measured.centre - measured.screen) <= 2,
      `status capsule centred at ${measured.centre}, screen centre is ${measured.screen}`,
    )
    await game.page.close()
  })
})
