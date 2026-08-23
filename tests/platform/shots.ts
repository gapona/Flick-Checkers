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

// The tutorial and the rules page. Both are new copy in narrow bands, and copy is the one thing a
// geometry assertion cannot judge — `layout.test.ts` proves nothing overlaps, this is for reading it.
for (const [w, h, name] of [
  [390, 844, 'portrait-390'],
  [844, 390, 'landscape-844'],
] as [number, number, string][]) {
  const game = await open(harness, { width: w, height: h, save: DEFAULT_SAVE })
  await game.page.waitForTimeout(500)
  await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu').scene.start('Tutorial'))
  await game.waitForScene('Tutorial')
  await game.page.waitForTimeout(900)
  await game.page.screenshot({ path: `build/shot-tutorial-${name}.png` })

  await game.page.evaluate(() => window.__game!.scene.getScene('Tutorial').scene.start('HowToPlay'))
  await game.waitForScene('HowToPlay')
  await game.page.waitForTimeout(700)
  await game.page.screenshot({ path: `build/shot-help-${name}.png` })
  await game.page.close()
  console.log('shot tutorial/help', name)
}

// And the settings panel, which grew a row and a height rule with it.
{
  const game = await open(harness, { width: 740, height: 360, save: DEFAULT_SAVE })
  await game.page.waitForTimeout(500)
  await game.page.evaluate(() => window.__game!.scene.getScene('MainMenu').scene.launch('Settings', { opener: 'MainMenu' }))
  await game.waitForScene('Settings')
  await game.page.waitForTimeout(600)
  await game.page.screenshot({ path: 'build/shot-settings-740x360.png' })
  await game.page.close()
  console.log('shot settings')
}

await harness.close()
