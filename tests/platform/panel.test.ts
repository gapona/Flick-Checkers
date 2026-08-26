import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { DEFAULT_SAVE, launch, open, startMatch, waitForSettled, type Harness } from './harness'

/**
 * The landscape side panel.
 *
 * Geometry is `verify:fit`'s job and it has eleven checks on it; what cannot be checked there is
 * whether the thing that gets DRAWN lands where the arithmetic said. Both defects found while
 * building it were of that kind and neither is expressible in node: the consumables ran out of both
 * edges of a 280-unit panel, and the balance and the round number were each on screen twice because
 * the top bar was still drawing them.
 */
describe('the landscape side panel', () => {
  let harness: Harness

  before(async () => {
    harness = await launch()
  })
  after(async () => {
    await harness.close()
  })

  it('appears in landscape, with the board clear of it', async () => {
    const game = await open(harness, { width: 1280, height: 720, save: DEFAULT_SAVE })
    await startMatch(game)
    await waitForSettled(game.page)

    const fit = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as {
        panelFit: { mode: string; board: { x: number; width: number }; panel: { x: number; width: number } | null }
      }
      return scene.panelFit
    })
    assert.equal(fit.mode, 'panel')
    assert.ok(fit.panel)
    // The gap between them is real, and the group is centred: the margin outside the board equals
    // the margin outside the panel. This is the property the reference brief was written against.
    assert.ok(fit.panel.x > fit.board.x + fit.board.width, 'the panel must not cross the board')
    const left = fit.board.x
    const right = 1280 - (fit.panel.x + fit.panel.width)
    assert.ok(Math.abs(left - right) < 1, `margins ${left} vs ${right}`)
    await game.page.close()
  })

  it('both blocks say who they are, and only one is lit', async () => {
    const game = await open(harness, { width: 1280, height: 720, save: DEFAULT_SAVE })
    await startMatch(game)
    await waitForSettled(game.page)

    const blocks = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as {
        opponentBlock: { text: { name: string; sub: string }; active: boolean }
        playerBlock: { text: { name: string; sub: string }; active: boolean }
        round: { turn: string }
      }
      return {
        opponent: { ...scene.opponentBlock.text, active: scene.opponentBlock.active },
        player: { ...scene.playerBlock.text, active: scene.playerBlock.active },
        turn: scene.round.turn,
      }
    })

    assert.ok(blocks.opponent.name.length > 0, 'the opponent block should name the character')
    assert.ok(blocks.player.name.length > 0)
    // Whose turn it is IS the lit block — exactly one of them, and it is the one the round says.
    assert.notEqual(blocks.opponent.active, blocks.player.active, 'exactly one block is lit')
    assert.equal(blocks.player.active, blocks.turn === 'player')
    await game.page.close()
  })

  /**
   * Blitz is a mode whose whole rule is a clock, and the panel used to draw no clock at all.
   *
   * The countdown was appended to the status capsule, and the panel hides that capsule — so the
   * number was on screen in portrait and nowhere in landscape, which is the layout every desktop
   * gets. Reported from the web build.
   */
  it('counts the blitz clock down in the active block', async () => {
    const game = await open(harness, { width: 1280, height: 720, save: { ...DEFAULT_SAVE, rules: 'blitz' } })
    await startMatch(game)
    await waitForSettled(game.page)

    const read = () =>
      game.page.evaluate(() => {
        const scene = window.__game!.scene.getScene('Game') as unknown as {
          rules: { shotClockMs: number }
          round: { turn: string }
          playerBlock: { text: { sub: string } }
        }
        return { clock: scene.rules.shotClockMs, turn: scene.round.turn, sub: scene.playerBlock.text.sub }
      })

    const first = await read()
    assert.ok(first.clock > 0, 'the seeded save must actually be the blitz set')
    assert.equal(first.turn, 'player', 'the clock only runs on a human turn')
    assert.match(first.sub, /\d/, `the player's block must carry the countdown, got "${first.sub}"`)

    // And it MOVES. A number that never changes is a label, and the mode is played on the change.
    await game.page.waitForTimeout(1200)
    const later = await read()
    assert.notEqual(later.sub, first.sub, `the countdown must tick, stayed at "${first.sub}"`)

    await game.page.close()
  })

  it('nothing the panel carries is also drawn by the top bar', async () => {
    const game = await open(harness, { width: 1280, height: 720, save: DEFAULT_SAVE })
    await startMatch(game)

    // The balance and the round pill move into the blocks, so the bar stops drawing them. Checked
    // through what is VISIBLE rather than through a flag, because the flag was not the bug — the bar
    // happily drew both while the panel did too.
    const doubled = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { topBar: { objects: { visible?: boolean; text?: string }[] } }
      return scene.topBar.objects.filter((o) => o.visible && typeof o.text === 'string' && o.text.length > 0).map((o) => o.text)
    })
    assert.deepEqual(doubled, [], `the top bar still draws ${doubled.join(', ')} while the panel carries it`)
    await game.page.close()
  })

  it('every action button stays inside the panel, at the width that broke it', async () => {
    // 844x390 puts the panel at its 280-unit minimum, which is where two compact buttons in a row
    // ran out of both edges.
    const game = await open(harness, { width: 844, height: 390, save: DEFAULT_SAVE })
    await startMatch(game)

    const fits = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as {
        panelFit: { panel: { x: number; width: number } | null }
        retakeButton: { container: Phaser.GameObjects.Container; width: number }
        powerButton: { container: Phaser.GameObjects.Container; width: number }
      }
      const panel = scene.panelFit.panel!
      return [scene.retakeButton, scene.powerButton].map((button) => {
        const m = button.container.getWorldTransformMatrix()
        return { left: m.tx - button.width / 2, right: m.tx + button.width / 2, panelLeft: panel.x, panelRight: panel.x + panel.width }
      })
    })
    for (const b of fits) {
      assert.ok(b.left >= b.panelLeft, `a button starts at ${b.left}, outside the panel at ${b.panelLeft}`)
      assert.ok(b.right <= b.panelRight, `a button ends at ${b.right}, outside the panel at ${b.panelRight}`)
    }
    await game.page.close()
  })

  it('the shop trip brings the match back rather than replacing it', async () => {
    const game = await open(harness, { width: 1280, height: 720, save: DEFAULT_SAVE })
    await startMatch(game)
    await waitForSettled(game.page)

    /**
     * The whole of the trap this button walked into, as one number.
     *
     * `Shop` is a nav DESTINATION here, not an overlay, so the button leaves the board — and a scene
     * restarted with no data starts a fresh match and discards the saved one. Marking the round with
     * a shot count and finding it again is what says the board came back rather than being rebuilt:
     * a fresh match is indistinguishable from a resumed one by the opening position alone, which is
     * exactly why this asserts on state the opening does not have.
     */
    await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { round: { shots: number } }
      scene.round.shots = 7
    })

    const shop = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { shopButton: { container: Phaser.GameObjects.Container } }
      const m = scene.shopButton.container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(shop.x, shop.y)
    await game.waitForScene('Shop')

    // Back the way a player goes back — the shop's own back button, which `bindAction` also binds to
    // ESC.
    await game.page.keyboard.press('Escape')
    await game.waitForScene('Game')
    await game.page.waitForFunction(() => Boolean((window.__game!.scene.getScene('Game') as unknown as { round?: unknown }).round))

    const shots = await game.page.evaluate(() => (window.__game!.scene.getScene('Game') as unknown as { round: { shots: number } }).round.shots)
    assert.equal(shots, 7, 'the board came back rebuilt instead of resumed')
    await game.page.close()
  })

  it('leaving asks first', async () => {
    const game = await open(harness, { width: 1280, height: 720, save: DEFAULT_SAVE })
    await startMatch(game)
    await waitForSettled(game.page)

    const leave = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as { leaveButton: { container: Phaser.GameObjects.Container } }
      const m = scene.leaveButton.container.getWorldTransformMatrix()
      return { x: m.tx, y: m.ty }
    })
    await game.click(leave.x, leave.y)

    // A round is ten to twenty shots of accumulated position and this button sits next to the shop;
    // it must not be able to throw that away on one tap.
    await game.waitForScene('Confirm')
    const stillPlaying = await game.page.evaluate(() => Boolean(window.__game!.scene.getScene('Game')))
    assert.equal(stillPlaying, true)
    await game.page.close()
  })

  it('portrait keeps the strips and never builds a panel', async () => {
    const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
    await startMatch(game)

    const state = await game.page.evaluate(() => {
      const scene = window.__game!.scene.getScene('Game') as unknown as {
        panelFit: { mode: string }
        statusText: { visible: boolean }
        opponentBlock: { active: boolean }
        sidePanel: { objects: { visible?: boolean }[] }
      }
      return {
        mode: scene.panelFit.mode,
        capsule: scene.statusText.visible,
        slab: scene.sidePanel.objects.some((o) => o.visible),
      }
    })
    assert.equal(state.mode, 'bands')
    assert.equal(state.capsule, true, 'the strip layout still owns the status capsule')
    assert.equal(state.slab, false, 'the panel must not be drawn where there is no room for it')
    await game.page.close()
  })
})
