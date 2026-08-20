import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { DEFAULT_SAVE, launch, open, startMatch, waitForSettled, type GamePage, type Harness } from './harness'

/**
 * The two wardrobes, and whether picking from one shows up anywhere.
 *
 * The catalogue was always two independent slots in the DATA — `SaveState.skins.board` and
 * `.pieces`, item ids namespaced so one purchase list can hold both — and one flat list of ten rows
 * on the SCREEN. That is the split this covers, plus the part that is easy to claim and easy to get
 * wrong: that a choice lands immediately, on the board and on the other wardrobe's previews, rather
 * than at some later restart.
 */
describe('the shop', () => {
  let harness: Harness

  before(async () => {
    harness = await launch()
  })
  after(async () => {
    await harness.close()
  })

  /** Into a match and then to the shop the way its own button goes — the trip that has to bring the
   * board back rather than replace it. */
  const openShop = async (game: GamePage): Promise<void> => {
    await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { openShop(): void }
      scene.openShop()
    })
    await game.waitForScene('Shop')
  }

  const pickTab = async (game: GamePage, index: number): Promise<void> => {
    const at = await game.page.evaluate((i: number) => {
      const shop = window.__game!.scene.getScene('Shop') as unknown as { tabs: { objects: Phaser.GameObjects.GameObject[] } }
      // graphics, then one hit rectangle per segment, then the labels.
      const hit = shop.tabs.objects[1 + i] as unknown as Phaser.GameObjects.Rectangle
      return { x: hit.x + hit.width / 2, y: hit.y }
    }, index)
    await game.click(at.x, at.y)
    await game.page.waitForTimeout(200)
  }

  /**
   * A row's button in SCREEN pixels.
   *
   * The rows are drawn through the scroll region's own camera, which has its own viewport origin and
   * its own `scrollY` — so a row's world position is not where it is on the screen, and clicking the
   * world position lands somewhere above the list. `getWorldTransformMatrix` is still the right
   * starting point (the button is inside a container), but the camera has to be undone afterwards.
   */
  const rowButtonAt = (game: GamePage, prefix: string): Promise<{ x: number; y: number; id: string }> =>
    game.page.evaluate((wanted: string) => {
      const shop = window.__game!.scene.getScene('Shop') as unknown as {
        rows: { item: { id: string }; action: { container: Phaser.GameObjects.Container } }[]
        region: { camera: { x: number; y: number; scrollX: number; scrollY: number } }
      }
      const row = shop.rows.find((r) => r.item.id.startsWith(wanted))!
      const m = row.action.container.getWorldTransformMatrix()
      const cam = shop.region.camera
      return { x: m.tx - cam.scrollX + cam.x, y: m.ty - cam.scrollY + cam.y, id: row.item.id }
    }, prefix)

  const visibleRows = (game: GamePage): Promise<string[]> =>
    game.page.evaluate(() => {
      const shop = window.__game!.scene.getScene('Shop') as unknown as { rows: { item: { id: string }; action: { container: { visible: boolean } } }[] }
      return shop.rows.filter((row) => row.action.container.visible).map((row) => row.item.id)
    })

  it('the header stacks without overlapping the bar above it or the tabs below', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu')!.scene.start('Shop'))
    await game.waitForScene('Shop')
    await game.page.waitForTimeout(300)

    /**
     * Both overlaps were real and neither was visible to anything else in the repo.
     *
     * The header was placed by two magic offsets — the top-up's centre at `top + 26` and the tabs at
     * `top + 52` — while a `compact` button is 60 tall once its thickness counts. Its own half-height
     * was therefore bigger than its offset, so it sat 5px ON the top bar (since before the tabs
     * existed) and 5px on the tabs (since they did). Two constants that have to agree with a widget's
     * measured height by hand will not agree for long.
     */
    const box = await game.page.evaluate(() => {
      const shop = window.__game!.scene.getScene('Shop') as unknown as {
        topup: { container: Phaser.GameObjects.Container; height: number }
        tabs: { objects: Phaser.GameObjects.GameObject[] }
        topBar: { height(s: unknown): number }
      }
      const m = shop.topup.container.getWorldTransformMatrix()
      const hit = shop.tabs.objects[1] as unknown as Phaser.GameObjects.Rectangle
      return {
        barBottom: shop.topBar.height(shop),
        topupTop: m.ty - shop.topup.height / 2,
        topupBottom: m.ty + shop.topup.height / 2,
        tabsTop: hit.y - hit.height / 2,
      }
    })
    assert.ok(box.topupTop >= box.barBottom, `the top-up starts at ${box.topupTop}, under a bar ending at ${box.barBottom}`)
    assert.ok(box.tabsTop >= box.topupBottom, `the tabs start at ${box.tabsTop}, under a button ending at ${box.topupBottom}`)
    await game.page.close()
  })

  it('shows one wardrobe at a time, and only that one', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await startMatch(game)
    await openShop(game)

    const boards = await visibleRows(game)
    assert.ok(boards.length > 0)
    assert.ok(
      boards.every((id) => id.startsWith('board-')),
      `the boards tab is showing ${boards.join(', ')}`,
    )

    await pickTab(game, 1)
    const discs = await visibleRows(game)
    assert.ok(discs.length > 0)
    assert.ok(
      discs.every((id) => id.startsWith('pieces-')),
      `the discs tab is showing ${discs.join(', ')}`,
    )
    await game.page.close()
  })

  it('a hidden row cannot be bought by a tap where it used to be', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await startMatch(game)
    await openShop(game)
    await pickTab(game, 1)

    // Phaser keeps serving pointer events to invisible objects, so a board row that merely went
    // invisible would still have a live Buy button under wherever a disc row is now drawn.
    const live = await game.page.evaluate(() => {
      const shop = window.__game!.scene.getScene('Shop') as unknown as {
        rows: { item: { id: string }; action: { container: { visible: boolean }; hitArea: { input: { enabled: boolean } | null } } }[]
      }
      return shop.rows.filter((row) => !row.action.container.visible && row.action.hitArea.input?.enabled).map((row) => row.item.id)
    })
    assert.deepEqual(live, [], `hidden rows still taking taps: ${live.join(', ')}`)
    await game.page.close()
  })

  it('one tap buys AND wears it, and the other wardrobe repaints against it', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await startMatch(game)
    await openShop(game)

    /**
     * A swatch previews a PAIR — a board against the discs you already wear, and vice versa — so
     * changing one slot has to repaint every row of the other. That is the whole of "on the fly"
     * inside this screen, and it is invisible to any check that only reads the save.
     */
    const before = await game.page.evaluate(() => {
      const shop = window.__game!.scene.getScene('Shop') as unknown as { rows: { item: { id: string }; swatch: { texture: { key: string } } }[] }
      return shop.rows.filter((r) => r.item.id.startsWith('pieces-')).map((r) => r.swatch.texture.key)
    })

    const buy = await rowButtonAt(game, 'board-')
    await game.click(buy.x, buy.y)

    // The store debounces its writes to once every two seconds, so this waits for the SAVE rather
    // than for a timeout — which also makes it a check that the choice is persisted at all.
    const wanted = buy.id.replace('board-', '')
    await game.page.waitForFunction(
      (id: string) => JSON.parse(window.localStorage.getItem('SAVE_DATA') ?? '{}').skins?.board === id,
      wanted,
      { timeout: 5000 },
    )

    // The disc rows repaint when their wardrobe is SHOWN, not while it is hidden — a row nobody can
    // see is not worth a re-render, and the swatch is rebuilt from the live pair the moment the tab
    // is opened. So the check is what the player actually sees: buy a board, look at the discs.
    await pickTab(game, 1)

    const after = await game.page.evaluate(() => {
      const shop = window.__game!.scene.getScene('Shop') as unknown as { rows: { item: { id: string }; swatch: { texture: { key: string } } }[] }
      return shop.rows.filter((r) => r.item.id.startsWith('pieces-')).map((r) => r.swatch.texture.key)
    })
    assert.notDeepEqual(after, before, 'the disc rows still preview against the board that was replaced')
    await game.page.close()
  })

  it('offers a way back to the match, and takes it', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await startMatch(game)
    await openShop(game)

    const at = await game.page.evaluate(() => {
      const shop = window.__game!.scene.getScene('Shop') as unknown as { backToMatch?: { container: Phaser.GameObjects.Container } }
      if (!shop.backToMatch) return null
      const m = shop.backToMatch.container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    assert.ok(at, 'a shop reached from a board should say so')

    await game.click(at.x, at.y)
    await game.waitForScene('Game')
    await game.page.waitForFunction(() => Boolean((window.__game!.scene.getScene('Game') as unknown as { round?: unknown }).round))
    await game.page.close()
  })

  it('does not offer it when there is no match behind the screen', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })

    // Straight to the shop from the menu's own navigation, which is how most visits happen.
    await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu')!.scene.start('Shop'))
    await game.waitForScene('Shop')

    const offered = await game.page.evaluate(() =>
      Boolean((window.__game!.scene.getScene('Shop') as unknown as { backToMatch?: unknown }).backToMatch),
    )
    assert.equal(offered, false, 'a shop reached from the menu has no match to go back to')
    await game.page.close()
  })

  it('an effect set reaches the board, emitters and all', async () => {
    const game = await open(harness, { width: 390, height: 844, save: { ...DEFAULT_SAVE, coins: 900 } })
    await startMatch(game)

    /**
     * The free set decorates ONE moment; `embers` decorates three. So the check is not "the id
     * changed" — it is that the two emitters a set asks for actually exist, which is the thing that
     * would silently not happen if the wiring read the wardrobe once at boot instead of per match.
     */
    const before = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { effects: { id: string }; trailParticles?: unknown; impactParticles?: unknown }
      return { id: scene.effects.id, trail: Boolean(scene.trailParticles), impact: Boolean(scene.impactParticles) }
    })
    assert.equal(before.id, 'classic')
    assert.equal(before.trail, false, 'the free set has no trail')
    assert.equal(before.impact, false)

    await openShop(game)
    await pickTab(game, 2)
    const buy = await rowButtonAt(game, 'fx-embers')
    await game.click(buy.x, buy.y)
    await game.page.waitForFunction(() => JSON.parse(window.localStorage.getItem('SAVE_DATA') ?? '{}').skins?.effects === 'embers', undefined, { timeout: 5000 })

    await game.page.keyboard.press('Escape')
    await game.waitForScene('Game')
    await game.page.waitForFunction(() => Boolean((window.__game!.scene.getScene('Game') as unknown as { effects?: unknown }).effects))

    const after = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { effects: { id: string }; trailParticles?: unknown; impactParticles?: unknown }
      return { id: scene.effects.id, trail: Boolean(scene.trailParticles), impact: Boolean(scene.impactParticles) }
    })
    assert.equal(after.id, 'embers')
    assert.equal(after.trail, true, 'embers asks for a trail and did not get an emitter')
    assert.equal(after.impact, true)
    await game.page.close()
  })

  it('the board is wearing it by the time you are back on it', async () => {
    const game = await open(harness, { width: 1280, height: 720, save: DEFAULT_SAVE })
    await startMatch(game)
    await waitForSettled(game.page)

    const before = await game.page.evaluate(
      () => (window.__game!.scene.getScene('Game') as unknown as { background: { texture: { key: string } } }).background.texture.key,
    )

    await openShop(game)
    const buy = await rowButtonAt(game, 'board-')
    await game.click(buy.x, buy.y)
    await game.page.waitForTimeout(250)

    await game.page.keyboard.press('Escape')
    await game.waitForScene('Game')
    await game.page.waitForFunction(() => Boolean((window.__game!.scene.getScene('Game') as unknown as { background?: unknown }).background))

    const after = await game.page.evaluate(
      () => (window.__game!.scene.getScene('Game') as unknown as { background: { texture: { key: string } } }).background.texture.key,
    )
    assert.notEqual(after, before, 'the board came back in the set it was bought out of')
    await game.page.close()
  })
})
