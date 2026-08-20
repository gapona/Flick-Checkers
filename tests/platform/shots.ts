/**
 * Screenshots of the HUD at the viewports that matter, for looking at.
 *
 * `npm run shots`. Not a test and never asserts anything — it is the tool that found the two layout
 * defects in the side panel (buttons outside the slab, a balance drawn twice), neither of which is
 * expressible in node and both of which are obvious in a picture.
 */
import { launch, open, startMatch, DEFAULT_SAVE } from './harness'

const harness = await launch()

for (const [w, h, name] of [
  [1280, 720, 'landscape-1280'],
  [844, 390, 'landscape-844'],
  [390, 844, 'portrait-390'],
] as [number, number, string][]) {
  const game = await open(harness, { width: w, height: h, save: DEFAULT_SAVE })
  await startMatch(game)
  await game.page.waitForTimeout(600)
  await game.page.screenshot({ path: `build/shot-${name}.png` })
  await game.page.close()
  console.log('shot', name)
}

// The shop, both wardrobes, reached the way a player reaches it from a match.
{
  const game = await open(harness, { width: 390, height: 844, save: DEFAULT_SAVE })
  await startMatch(game)
  await game.page.evaluate(() => {
    const scene = window.__game!.scene.getScene('Game') as unknown as { openShop(): void }
    scene.openShop()
  })
  await game.waitForScene('Shop')
  await game.page.waitForTimeout(400)
  await game.page.screenshot({ path: 'build/shot-shop-boards.png' })

  await game.page.evaluate(() => {
    const scene = window.__game!.scene.getScene('Shop') as unknown as { tabs: { objects: { setInteractive?: unknown }[] }; tab: number }
    void scene
  })
  const second = await game.page.evaluate(() => {
    const shop = window.__game!.scene.getScene('Shop') as unknown as { tabs: { objects: Phaser.GameObjects.GameObject[] } }
    // The hit rectangles are the middle slice of `objects` — one per segment, after the graphics.
    const hit = shop.tabs.objects[2] as unknown as Phaser.GameObjects.Rectangle
    return { x: hit.x + hit.width / 2, y: hit.y }
  })
  await game.click(second.x, second.y)
  await game.page.waitForTimeout(300)
  await game.page.screenshot({ path: 'build/shot-shop-discs.png' })
  await game.page.close()
  console.log('shot shop')
}

await harness.close()
