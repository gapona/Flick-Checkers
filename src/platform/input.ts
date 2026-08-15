import * as Phaser from 'phaser'

export interface ActionSources {
  /** Game object(s) that trigger the action on `pointerdown` — Phaser unifies mouse and
   * touch into one Pointer API, so this covers both with no "what kind of device is this"
   * branch needed. The object(s) must already be `.setInteractive()`'d elsewhere (see
   * `src/ui/uiScale.ts`'s `ensureMinHitArea` for the touch-target sizing side of that). */
  pointer?: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]
  /** Phaser keyboard key names (e.g. `'SPACE'`, `'ENTER'`, `'ESC'`) that trigger the same action. */
  keys?: string[]
}

/**
 * Maps one abstract game action to as many input sources as needed, all firing the same
 * callback — gameplay/UI code binds to "what the player wants to do" once, never to a
 * specific device's raw event. Mouse, touch, and keyboard all work at the same time; there
 * is no "detect device type" branch anywhere in this module or its callers.
 *
 * Every source is guarded to only fire while `scene` is the active (non-paused) scene.
 * Pointer targets are already physically shielded by whatever overlay paused this scene
 * (e.g. `Settings`' full-screen backdrop swallows the click before it reaches anything
 * underneath) — but a paused scene's own `input.keyboard` listeners keep firing regardless
 * (Phaser doesn't suspend a scene's Input Plugin on pause, only its `update()`/render), so
 * without this guard a backgrounded scene's key binding would fire right alongside the
 * overlay's for the same keypress. See CLAUDE.md "Input Actions".
 *
 * Cleans up all listeners on scene `SHUTDOWN`/`DESTROY`, mirroring `src/ui/layout.ts`'s
 * `bindLayout`.
 */
export function bindAction(scene: Phaser.Scene, action: string, sources: ActionSources, callback: () => void): void {
  const guarded = () => {
    if (!scene.scene.isActive()) return
    console.debug(`[input] action "${action}" fired`)
    callback()
  }

  const cleanups: Array<() => void> = []

  const pointerTargets = sources.pointer ? (Array.isArray(sources.pointer) ? sources.pointer : [sources.pointer]) : []
  for (const target of pointerTargets) {
    target.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, guarded)
    cleanups.push(() => target.off(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, guarded))
  }

  for (const key of sources.keys ?? []) {
    const eventName = `keydown-${key}`
    scene.input.keyboard?.on(eventName, guarded)
    cleanups.push(() => scene.input.keyboard?.off(eventName, guarded))
  }

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => cleanups.forEach((fn) => fn()))
  scene.events.once(Phaser.Scenes.Events.DESTROY, () => cleanups.forEach((fn) => fn()))

  console.debug(
    `[input] bound action "${action}": ${pointerTargets.length} pointer target(s), keys [${(sources.keys ?? []).join(', ')}]`,
  )
}
