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
/**
 * The pointer is passed only when the action was triggered by one — a keyboard source fires the
 * same callback with `undefined`. Most callers ignore it; a caller that needs *where* the tap
 * landed (the board's cell hit test) reads it, and must still handle the keyboard case.
 */
export type ActionCallback = (pointer?: Phaser.Input.Pointer) => void

export function bindAction(scene: Phaser.Scene, action: string, sources: ActionSources, callback: ActionCallback): void {
  const guarded = (pointer?: Phaser.Input.Pointer) => {
    if (!scene.scene.isActive()) return
    console.debug(`[input] action "${action}" fired`)
    callback(pointer)
  }

  const cleanups: Array<() => void> = []

  const pointerTargets = sources.pointer ? (Array.isArray(sources.pointer) ? sources.pointer : [sources.pointer]) : []
  const onPointerDown = (pointer: Phaser.Input.Pointer) => guarded(pointer)
  for (const target of pointerTargets) {
    target.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onPointerDown)
    cleanups.push(() => target.off(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onPointerDown))
  }

  // Phaser hands a keyboard listener the KeyboardEvent, which is not a Pointer — the wrapper
  // drops it rather than passing something a caller could mistake for one.
  const onKeyDown = () => guarded()
  for (const key of sources.keys ?? []) {
    const eventName = `keydown-${key}`
    scene.input.keyboard?.on(eventName, onKeyDown)
    cleanups.push(() => scene.input.keyboard?.off(eventName, onKeyDown))
  }

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => cleanups.forEach((fn) => fn()))
  scene.events.once(Phaser.Scenes.Events.DESTROY, () => cleanups.forEach((fn) => fn()))

  console.debug(
    `[input] bound action "${action}": ${pointerTargets.length} pointer target(s), keys [${(sources.keys ?? []).join(', ')}]`,
  )
}

/**
 * How many pointers are currently down (fingers, or a held mouse button — Phaser's pointer array
 * holds the mouse at index 0 and the touch pointers after it, capped by `input.activePointers`
 * in `config.ts`).
 *
 * For a tap handler that must not fire mid-gesture: a two-finger pan also delivers a
 * `pointerdown` per finger, so a caller that would otherwise act on the first of them checks
 * this instead of subscribing to raw input itself.
 */
export function activePointerCount(scene: Phaser.Scene): number {
  return scene.input.manager.pointers.reduce((total, pointer) => (pointer.isDown ? total + 1 : total), 0)
}

export interface PanOptions {
  /** Pointers that must be down for the gesture to count. Defaults to 2 — one finger is
   * reserved for direct manipulation (selecting/dragging a piece), per CONCEPT.md §3. */
  minPointers?: number
  /** Polled on every move: lets a scene arm/disarm the gesture as its own state changes (the
   * board only pans when it doesn't fit — see `iso/fit.ts`'s `panEnabled`) without rebinding. */
  isEnabled?: () => boolean
}

/**
 * A continuous multi-pointer drag, reported as per-move deltas of the pointers' CENTROID in
 * screen px. Lives here, not in a scene, for the same reason `bindAction` does: scenes describe
 * intent ("pan the board") and never touch raw pointer events. `bindAction` can't express this —
 * it maps discrete triggers, and a gesture is a stream.
 *
 * The centroid resets (one move is skipped, no delta reported) whenever the number of pointers
 * down changes, because adding or lifting a finger moves the centroid instantly — without the
 * reset, a second finger touching down would teleport the board by half the distance between the
 * two fingers.
 *
 * Deltas are in screen px; the caller divides by the camera zoom to get world units — this module
 * knows nothing about cameras.
 */
export function bindPan(scene: Phaser.Scene, action: string, options: PanOptions, onPan: (dx: number, dy: number) => void): void {
  const minPointers = options.minPointers ?? 2
  let last: { x: number; y: number } | null = null
  let lastCount = 0

  const onMove = () => {
    if (!scene.scene.isActive() || (options.isEnabled && !options.isEnabled())) {
      last = null
      return
    }

    const down = scene.input.manager.pointers.filter((pointer) => pointer.isDown)
    if (down.length < minPointers) {
      last = null
      lastCount = down.length
      return
    }

    const centroid = {
      x: down.reduce((sum, p) => sum + p.x, 0) / down.length,
      y: down.reduce((sum, p) => sum + p.y, 0) / down.length,
    }

    if (last && down.length === lastCount) onPan(centroid.x - last.x, centroid.y - last.y)
    last = centroid
    lastCount = down.length
  }

  const onRelease = () => {
    last = null
  }

  scene.input.on(Phaser.Input.Events.POINTER_MOVE, onMove)
  scene.input.on(Phaser.Input.Events.POINTER_UP, onRelease)
  scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onRelease)

  const cleanup = () => {
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, onMove)
    scene.input.off(Phaser.Input.Events.POINTER_UP, onRelease)
    scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onRelease)
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup)
  scene.events.once(Phaser.Scenes.Events.DESTROY, cleanup)

  console.debug(`[input] bound pan gesture "${action}": ${minPointers}+ pointers`)
}

export interface DragHandlers {
  /**
   * The gate. Called on press; return `false` to refuse the gesture entirely, in which case no
   * further callback fires for it.
   *
   * This is where the caller decides whether the press means anything — for the aim gesture, whether
   * it landed on one of the player's own live discs (CHAPAEV-PLAN.md §2, trap 4). Refusing is normal
   * and silent: most presses on a board are not the start of a shot.
   */
  onStart: (pointer: Phaser.Input.Pointer) => boolean
  onMove: (pointer: Phaser.Input.Pointer) => void
  /** The gesture completed normally — the finger lifted. */
  onEnd: (pointer: Phaser.Input.Pointer) => void
  /** The gesture was abandoned rather than finished: a second finger arrived, or the scene was
   * paused mid-drag. The caller must undo whatever `onStart` set up, and must NOT treat it as a
   * release — a cancelled aim fires nothing. */
  onCancel: () => void
}

/**
 * A single-pointer press-drag-release on one game object.
 *
 * Lives here rather than in a scene for the same reason {@link bindPan} does: scenes describe
 * intent and never touch raw pointer events. `bindAction` cannot express this — it maps discrete
 * triggers, and a drag is a stream with a beginning, a middle and two different endings.
 *
 * **Multi-touch is refused rather than interpreted.** A press while another pointer is already down
 * never starts a gesture, and a second finger arriving mid-drag cancels the one in progress. §2's
 * trap 4 is that aiming with one finger and panning with two begin identically; this project
 * resolves it by having no pan at all (`board/layout.ts`: the board always fits), which leaves the
 * single-finger drag unambiguous — but only if a fumbled two-finger press is thrown away instead of
 * being read as whichever finger landed first.
 *
 * Positions are reported in SCREEN pixels, as Phaser delivers them; the caller converts through its
 * own camera. This module knows nothing about cameras, exactly like `bindPan`.
 */
export function bindDrag(scene: Phaser.Scene, action: string, target: Phaser.GameObjects.GameObject, handlers: DragHandlers): void {
  /** Id of the pointer that owns the gesture in progress, or `null` when idle. Tracked by id rather
   * than by a boolean so a second finger's move and release events cannot drive someone else's
   * drag. */
  let activeId: number | null = null

  const cancel = () => {
    if (activeId === null) return
    activeId = null
    handlers.onCancel()
  }

  const onDown = (pointer: Phaser.Input.Pointer) => {
    if (!scene.scene.isActive()) return
    if (activeId !== null) {
      // A second finger during a drag: the gesture is now ambiguous, so it is abandoned rather than
      // guessed at.
      cancel()
      return
    }
    if (activePointerCount(scene) > 1) return
    if (!handlers.onStart(pointer)) return
    activeId = pointer.id
  }

  const onMove = (pointer: Phaser.Input.Pointer) => {
    if (activeId !== pointer.id) return
    if (!scene.scene.isActive()) {
      cancel()
      return
    }
    handlers.onMove(pointer)
  }

  const onUp = (pointer: Phaser.Input.Pointer) => {
    if (activeId !== pointer.id) return
    activeId = null
    if (!scene.scene.isActive()) {
      handlers.onCancel()
      return
    }
    handlers.onEnd(pointer)
  }

  target.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onDown)
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, onMove)
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp)
  // A release outside the canvas still ends the gesture. Without this a drag that finishes off the
  // edge of the screen leaves the aim stuck on screen and the pointer id held forever.
  scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp)

  const cleanup = () => {
    target.off(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onDown)
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, onMove)
    scene.input.off(Phaser.Input.Events.POINTER_UP, onUp)
    scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp)
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup)
  scene.events.once(Phaser.Scenes.Events.DESTROY, cleanup)

  console.debug(`[input] bound drag gesture "${action}"`)
}
