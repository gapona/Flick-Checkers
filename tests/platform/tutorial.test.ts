import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { buttonAt, DEFAULT_SAVE, launch, open, startMatch, waitForOverlay, waitForSettled, type GamePage, type Harness } from './harness'
import { LESSONS } from '../../src/game/tutorial'

/**
 * The tutorial and the rules page, clicked the way a player clicks them.
 *
 * **What this covers that `tests/gameplay/tutorial.test.ts` cannot.** That file proves every lesson
 * is winnable, through the real solver, under plain node — and it never boots a scene, so it is
 * blind to the entire wiring: whether the menu offers the tutorial, whether a solved lesson advances,
 * whether the last one writes the save, and whether the rules page can be reached from the gear and
 * left again. Every one of those is a callback between two scenes, which is exactly the class of bug
 * this harness was built for (see `harness.ts`: a queued RESUME that made the game unstartable, with
 * `tsc` and eighty unit tests green).
 *
 * The lessons are solved by REACHING INTO the scene rather than by aiming a mouse at a disc. Aiming
 * is `layout.test.ts`' job and it holds the gesture there; here the question is what happens once a
 * shot has resolved, and driving that through a pixel-accurate drag would make every assertion in
 * this file depend on the physics staying exactly as tuned.
 */

/** Marks the current lesson as solved and presses the button, without firing a shot. */
async function passLesson(game: GamePage): Promise<void> {
  await game.page.evaluate(() => {
    const scene = window.__game!.scene.getScene('Tutorial') as unknown as { passed: boolean }
    scene.passed = true
  })
  const button = await buttonAt(game.page, 'Tutorial', 'actionButton')
  await game.click(button.x, button.y)
  await game.page.waitForTimeout(350)
}

function lessonIndex(game: GamePage): Promise<number> {
  return game.page.evaluate(() => (window.__game!.scene.getScene('Tutorial') as unknown as { index: number }).index)
}

/** The persisted save, as the stub writes it outside Playables. It lags the in-memory state by up
 * to the two-second debounce `save/store.ts` applies, which is why every caller waits first. */
function tutorialDoneInStore(game: GamePage): Promise<boolean> {
  return game.page.evaluate(() => {
    const raw = window.localStorage.getItem('SAVE_DATA') ?? ''
    return raw.includes('"tutorialDone":true')
  })
}

describe('the tutorial', () => {
  let harness: Harness

  before(async () => {
    harness = await launch()
  })
  after(async () => {
    await harness.close()
  })

  it('is offered on the menu until it has been finished, and not after', async () => {
    const fresh = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await fresh.page.waitForTimeout(500)
    assert.equal(
      await fresh.page.evaluate(() => Boolean((window.__game!.scene.getScene('MainMenu') as unknown as { tutorialButton?: unknown }).tutorialButton)),
      true,
      'a save that has never seen the tutorial should be offered it',
    )
    await fresh.page.close()

    const done = await open(harness, { width: 390, height: 844, save: { ...DEFAULT_SAVE, tutorialDone: true } })
    await done.page.waitForTimeout(500)
    assert.equal(
      await done.page.evaluate(() => Boolean((window.__game!.scene.getScene('MainMenu') as unknown as { tutorialButton?: unknown }).tutorialButton)),
      false,
      'the offer should go away once it has been taken',
    )
    await done.page.close()
  })

  it('walks all six lessons and records that it was finished', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await game.page.waitForTimeout(500)

    const enter = await buttonAt(game.page, 'MainMenu', 'tutorialButton')
    await game.click(enter.x, enter.y)
    await game.waitForScene('Tutorial')
    await game.page.waitForFunction(() => Boolean((window.__game!.scene.getScene('Tutorial') as unknown as { board?: unknown }).board))
    await game.page.waitForTimeout(400)

    assert.equal(await lessonIndex(game), 0)

    for (let i = 0; i < LESSONS.length - 1; i++) {
      assert.equal(await lessonIndex(game), i, `expected to be on lesson ${i}`)
      await passLesson(game)
    }
    assert.equal(await lessonIndex(game), LESSONS.length - 1, 'the last lesson should be reached, not skipped past')

    // The last one ends on the three-way panel rather than advancing.
    await passLesson(game)
    await game.waitForScene('Confirm')
    await waitForOverlay(game.page, 'Confirm')

    const choices = await game.page.evaluate(
      () => (window.__game!.scene.getScene('Confirm') as unknown as { buttons: unknown[] }).buttons.length,
    )
    assert.equal(choices, 3, 'play a match, the rules page, and the menu')

    // `store.flush()` is not called here; the debounce is two seconds and the panel is already up.
    await game.page.waitForTimeout(2500)
    assert.equal(await tutorialDoneInStore(game), true, 'finishing must be written to the save')

    // The gold answer takes the player into a match, from a cleared nav stack.
    const play = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Confirm') as unknown as { buttons: { container: Phaser.GameObjects.Container }[] }
      const m = scene.buttons[0].container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(play.x, play.y)
    await game.waitForScene('Modes')

    await game.page.close()
  })

  it('a real drag solves the first lesson and the button becomes Next', async () => {
    /**
     * The one test here that fires an actual gesture, and the only one that exercises the whole
     * chain: `bindDrag` -> `computeAim` -> `applyImpulse` -> the solver -> `settle` -> the button
     * changing under the player's thumb. Everything else in this file reaches in, on purpose.
     *
     * Lesson one is the right place to spend it: the enemy is four cells straight ahead of the
     * shooter with a cell and a half of board behind it, so a full pull straight back cannot miss —
     * `tests/gameplay/tutorial.test.ts` measures that this is the forgiving one. If this ever starts
     * failing, ask whether the GESTURE broke before asking whether the lesson got harder.
     */
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await game.page.waitForTimeout(500)
    const enter = await buttonAt(game.page, 'MainMenu', 'tutorialButton')
    await game.click(enter.x, enter.y)
    await game.waitForScene('Tutorial')
    await game.page.waitForTimeout(700)

    const disc = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Tutorial') as unknown as {
        sim: { discs: { x: number; y: number; side: string; alive: boolean }[] }
      }
      const camera = window.__game!.scene.getScene('Tutorial').cameras.main
      const mine = scene.sim.discs.find((d) => d.side === 'player' && d.alive)!
      const view = camera.worldView
      return { x: camera.x + (mine.x - view.x) * camera.zoom, y: camera.y + (mine.y - view.y) * camera.zoom }
    })

    // Straight DOWN the screen: the disc flies away from the finger, so pulling back sends it up the
    // board at the enemy. Far enough to reach full power whatever the aim camera settles at.
    await game.page.mouse.move(disc.x, disc.y)
    await game.page.mouse.down()
    await game.page.mouse.move(disc.x, disc.y + 260, { steps: 12 })
    await game.page.waitForTimeout(250)
    await game.page.mouse.up()

    await game.page.waitForFunction(
      () => (window.__game!.scene.getScene('Tutorial') as unknown as { passed: boolean }).passed,
      undefined,
      { timeout: 15_000 },
    )

    const label = await game.page.evaluate(
      () => (window.__game!.scene.getScene('Tutorial') as unknown as { actionButton: { text: string } }).actionButton.text,
    )
    assert.notEqual(label, 'Skip', 'a solved lesson must offer Next, not Skip')

    const button = await buttonAt(game.page, 'Tutorial', 'actionButton')
    await game.click(button.x, button.y)
    await game.page.waitForTimeout(400)
    assert.equal(await lessonIndex(game), 1, 'Next must move on to the second lesson')

    await game.page.close()
  })

  it('the ending panel can also hand off to the rules page', async () => {
    /**
     * The second of the panel's three answers, and it gets its own case because of what it is: a
     * `scene.start` fired from a `Confirm` callback, which runs after the opener's resume has been
     * REQUESTED and before it has happened. CLAUDE.md's "Known Issues Fixed" records a shipped bug of
     * exactly that shape — `Modes.askRival`'s answers both bailing out on a flag a queued RESUME had
     * not cleared yet, which made the game unstartable with every other check green.
     */
    const game = await open(harness, { width: 390, height: 844, save: { ...DEFAULT_SAVE, tutorialDone: true } })
    await game.page.waitForTimeout(500)
    await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu').scene.start('Tutorial', { lesson: 5 }))
    await game.waitForScene('Tutorial')
    await game.page.waitForTimeout(600)
    assert.equal(await lessonIndex(game), 5, 'the entry point should be able to open on a given lesson')

    await passLesson(game)
    await game.waitForScene('Confirm')
    await waitForOverlay(game.page, 'Confirm')

    const rules = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Confirm') as unknown as { buttons: { container: Phaser.GameObjects.Container }[] }
      const m = scene.buttons[1].container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(rules.x, rules.y)
    await game.waitForScene('HowToPlay')
    await game.page.waitForTimeout(400)

    assert.equal(
      await game.page.evaluate(() => window.__game!.scene.getScene('Tutorial').scene.isActive()),
      false,
      'the tutorial must not still be running underneath',
    )

    await game.page.close()
  })

  it('an unsolved lesson can still be left, and the board resets after a failure', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await game.page.waitForTimeout(500)
    const enter = await buttonAt(game.page, 'MainMenu', 'tutorialButton')
    await game.click(enter.x, enter.y)
    await game.waitForScene('Tutorial')
    await game.page.waitForTimeout(600)

    // Skip is the same button, unsolved. Nothing here may trap a player who cannot make the shot.
    const skip = await buttonAt(game.page, 'Tutorial', 'actionButton')
    await game.click(skip.x, skip.y)
    await game.page.waitForTimeout(300)
    assert.equal(await lessonIndex(game), 1, 'Skip must advance without the goal being met')

    // Fire a shot that cannot satisfy the goal — straight backwards, away from everything — and
    // require the board to come back rather than sit there spent. Driven by hand rather than by a
    // drag: what is under test is what happens AFTER a shot resolves, and a real gesture would tie
    // this assertion to the exact tuning of the physics.
    const before = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Tutorial') as unknown as { sim: { discs: { alive: boolean }[] } }
      return scene.sim.discs.filter((d) => d.alive).length
    })

    await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Tutorial') as unknown as {
        sim: { discs: { id: number; side: string; alive: boolean; vx: number; vy: number }[] }
        shotOutcome: unknown
        shotsTaken: number
      }
      const disc = scene.sim.discs.find((d) => d.side === 'player' && d.alive)!
      scene.shotsTaken = 1
      // A `SimOutcome` is plain data, so it can be built here — importing `createOutcome` from a
      // dynamic `import()` would get a different module instance (CLAUDE.md, "Audio Layer").
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
      // Straight down the board, away from the enemy: it will stop short, having done nothing.
      disc.vx = 0
      disc.vy = 200
    })
    // The shot, then the hint, then `RESET_DELAY_MS` before the board comes back.
    await game.page.waitForTimeout(3000)

    const after = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Tutorial') as unknown as {
        sim: { discs: { alive: boolean }[] }
        passed: boolean
      }
      return { alive: scene.sim.discs.filter((d) => d.alive).length, passed: scene.passed }
    })
    assert.equal(after.passed, false, 'a failed shot must not be scored as a pass')
    assert.equal(after.alive, before, 'the board must be put back after a failure')

    await game.page.close()
  })
})

describe('the rules page', () => {
  let harness: Harness

  before(async () => {
    harness = await launch()
  })
  after(async () => {
    await harness.close()
  })

  it('is reachable from the gear on the menu, and comes back', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await game.page.waitForTimeout(500)

    await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu').scene.launch('Settings', { opener: 'MainMenu' }))
    await game.waitForScene('Settings')
    await waitForOverlay(game.page, 'Settings')

    const help = await buttonAt(game.page, 'Settings', 'helpButton')
    await game.click(help.x, help.y)
    await game.waitForScene('HowToPlay')
    await game.page.waitForTimeout(500)

    // Every chapter of the reference actually rendered, headings and copy alike.
    const rows = await game.page.evaluate(() => (window.__game!.scene.getScene('HowToPlay') as unknown as { rows: unknown[] }).rows.length)
    assert.ok(rows >= 30, `expected the whole reference to be built, got ${rows} rows`)

    const back = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('HowToPlay') as unknown as { topBar: { objects: Phaser.GameObjects.GameObject[] } }
      const containers = scene.topBar.objects.filter((o) => o.type === 'Container') as Phaser.GameObjects.Container[]
      const m = containers[0].getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(back.x, back.y)
    await game.waitForScene('MainMenu')

    await game.page.close()
  })

  it('offers the tutorial from the menu, and does NOT offer it over a live match', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await game.page.waitForTimeout(500)

    await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu').scene.start('HowToPlay'))
    await game.waitForScene('HowToPlay')
    await game.page.waitForTimeout(400)
    assert.equal(
      await game.page.evaluate(() => Boolean((window.__game!.scene.getScene('HowToPlay') as unknown as { tutorialButton?: unknown }).tutorialButton)),
      true,
      'reached from the menu, the hands-on half should be offered',
    )
    await game.page.close()

    const playing = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await startMatch(playing)
    await waitForSettled(playing.page)

    await playing.page.evaluate(() => window.__game!.scene.getScene('Game').scene.launch('Settings', { opener: 'Game' }))
    await playing.waitForScene('Settings')
    await waitForOverlay(playing.page, 'Settings')
    const help = await buttonAt(playing.page, 'Settings', 'helpButton')
    await playing.click(help.x, help.y)
    await playing.waitForScene('HowToPlay')
    await playing.page.waitForTimeout(400)

    assert.equal(
      await playing.page.evaluate(() =>
        Boolean((window.__game!.scene.getScene('HowToPlay') as unknown as { tutorialButton?: unknown }).tutorialButton),
      ),
      false,
      'over a match, starting the tutorial would strand the player off the board they left',
    )

    /**
     * And the way home is the board, not a fresh match.
     *
     * This is the `{ resume: true }` half of `Settings.openHelp()`. Without it the back button would
     * start a brand-new match over the saved one, silently — the exact bug `ui/chrome.ts` gave
     * `NavEntry` return data to prevent, and the reason `tests/platform/panel.test.ts` exists for the
     * shop button that has the same shape.
     */
    const mark = await playing.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { sim: { discs: { alive: boolean }[] } }
      return scene.sim.discs.filter((d) => d.alive).length
    })

    const back = await playing.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('HowToPlay') as unknown as { topBar: { objects: Phaser.GameObjects.GameObject[] } }
      const containers = scene.topBar.objects.filter((o) => o.type === 'Container') as Phaser.GameObjects.Container[]
      const m = containers[0].getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await playing.click(back.x, back.y)
    await playing.waitForScene('Game')
    await waitForSettled(playing.page)

    const resumed = await playing.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { sim: { discs: { alive: boolean }[] } }
      return scene.sim.discs.filter((d) => d.alive).length
    })
    assert.equal(resumed, mark, 'the same board should be back, not a fresh one')

    await playing.page.close()
  })
})
