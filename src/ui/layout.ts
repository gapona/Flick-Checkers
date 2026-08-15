import * as Phaser from 'phaser'

/**
 * Wires a scene's `layout(width, height)` to run once immediately (using the scene's
 * current scale) and again on every ScaleManager RESIZE event, unbinding on scene
 * shutdown/destroy so a stopped scene doesn't keep reacting to resizes.
 */
export function bindLayout(scene: Phaser.Scene, layout: (width: number, height: number) => void): void {
  const onResize = (gameSize: Phaser.Structs.Size) => layout(gameSize.width, gameSize.height)

  scene.scale.on(Phaser.Scale.Events.RESIZE, onResize)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, onResize))
  scene.events.once(Phaser.Scenes.Events.DESTROY, () => scene.scale.off(Phaser.Scale.Events.RESIZE, onResize))

  layout(scene.scale.width, scene.scale.height)
}
