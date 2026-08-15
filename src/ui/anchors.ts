import * as Phaser from 'phaser'

/**
 * Any positionable game object that knows its owning scene — Text, Image, Rectangle,
 * Container, etc. all satisfy this via Phaser's Transform component mixin.
 */
type Anchorable = Phaser.GameObjects.Components.Transform & { scene: Phaser.Scene }

function viewport(obj: Anchorable): { width: number; height: number } {
  const { width, height } = obj.scene.scale
  return { width, height }
}

// Corners and edge-centers, read live from the object's scene each call — so a single
// anchor call after a resize is enough, no cached width/height to go stale.

export function anchorTopLeft(obj: Anchorable, dx = 0, dy = 0): void {
  obj.setPosition(dx, dy)
}

export function anchorTopCenter(obj: Anchorable, dx = 0, dy = 0): void {
  const { width } = viewport(obj)
  obj.setPosition(width / 2 + dx, dy)
}

export function anchorTopRight(obj: Anchorable, dx = 0, dy = 0): void {
  const { width } = viewport(obj)
  obj.setPosition(width - dx, dy)
}

export function anchorCenterLeft(obj: Anchorable, dx = 0, dy = 0): void {
  const { height } = viewport(obj)
  obj.setPosition(dx, height / 2 + dy)
}

export function anchorCenter(obj: Anchorable, dx = 0, dy = 0): void {
  const { width, height } = viewport(obj)
  obj.setPosition(width / 2 + dx, height / 2 + dy)
}

export function anchorCenterRight(obj: Anchorable, dx = 0, dy = 0): void {
  const { width, height } = viewport(obj)
  obj.setPosition(width - dx, height / 2 + dy)
}

export function anchorBottomLeft(obj: Anchorable, dx = 0, dy = 0): void {
  const { height } = viewport(obj)
  obj.setPosition(dx, height - dy)
}

export function anchorBottomCenter(obj: Anchorable, dx = 0, dy = 0): void {
  const { width, height } = viewport(obj)
  obj.setPosition(width / 2 + dx, height - dy)
}

export function anchorBottomRight(obj: Anchorable, dx = 0, dy = 0): void {
  const { width, height } = viewport(obj)
  obj.setPosition(width - dx, height - dy)
}
