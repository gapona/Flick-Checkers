import * as Phaser from 'phaser'

/**
 * WebGL-safe replacement for clipping a scrollable region with `GameObject.setMask()`.
 *
 * RULE: never use `setMask(geometryMask)` to clip a scrollable list/strip to a rectangle.
 * Confirmed against `node_modules/phaser/src/gameobjects/components/Mask.js`: under this
 * project's actual renderer (`Phaser.AUTO`, WebGL-first — see `config.ts`), `setMask()` with
 * a `GeometryMask` prints a console warning and returns WITHOUT assigning `.mask` at all — a
 * silent no-op, not a subtle degradation. The object then renders in full wherever its
 * computed position places it, with zero clipping, which is exactly what lets scrolled
 * content escape its intended region and render on top of whatever sits above/below it. This
 * was independently hit and fixed the same way in three separate scrollable/maskable UI
 * regions across a real project built on this template before being generalized into this
 * helper — treat it as a standing fact about this renderer, not a one-off bug.
 *
 * Fix: a dedicated `Camera` whose *viewport* IS the clip rectangle. A camera's viewport is a
 * hard, native clip boundary — nothing outside it can ever render there, no filter/mask
 * machinery involved — and its own `scrollY`/`scrollX` does the panning a hand-rolled
 * "reposition every row's Container on every scroll tick" loop used to do, for free (also
 * cheaper: content is positioned ONCE, at its true unscrolled coordinates, not re-touched
 * every scroll tick).
 *
 * Usage (same shape as `Game.ts`'s own world/UI two-camera split — see CLAUDE.md "Responsive
 * Layout"): create once in `create()`, call `region.camera.ignore(everythingElse)` and
 * `scene.cameras.main.ignore(scrollableObjects)` — the mutual ignore lists are the caller's
 * responsibility, since only the caller knows which of its own objects belong to which half.
 * Resize the clip rectangle from `layout()` via `setBounds()`; drive panning by assigning
 * `region.camera.scrollY` (or `.scrollX` for a horizontal strip) from your own scroll-offset
 * state (see `scrollMomentum.ts` for a ready-made physics module to drive that offset).
 *
 * A scene with its OWN in-scene popups/overlays that must render on top of the scrollable
 * region needs a THIRD camera (added after this one, full viewport, holding only the overlay
 * objects) — a later-added camera always composites on top of an earlier one's output, so
 * with only two cameras the scroll region would draw over a centered popup wherever they
 * overlap.
 */
export interface ScrollRegionBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ScrollableCameraRegion {
  /** The dedicated clipping camera — call `.ignore(...)` on it yourself for every
   * non-scrollable object in the scene, and call `scene.cameras.main.ignore(...)` for every
   * object that belongs to this region. */
  camera: Phaser.Cameras.Scene2D.Camera
  /** Resizes/repositions the clip rectangle — call every `layout()` pass. Width/height are
   * floored at 1px (a 0-size camera viewport throws in Phaser). */
  setBounds(bounds: ScrollRegionBounds): void
  /** Removes the camera from the scene's `CameraManager` — call from scene `SHUTDOWN`/`DESTROY`
   * if the region is ever created more than once per scene lifetime (a scene that only ever
   * creates one in `create()` doesn't need this; Phaser tears cameras down with the scene). */
  destroy(): void
}

/**
 * The clip height for a list that has to fit BETWEEN two fixed things — a top bar above, a pinned
 * button or a nav bar below.
 *
 * **It exists because the obvious spelling is wrong and all three lists in this game had it.** They
 * wrote `Math.max(80, bottom - top)`: a minimum meant to keep the list usable, which on a short
 * screen grants the list pixels the screen does not have and pushes it straight through whatever
 * was below. Measured in landscape, where the two bars eat half the height: the shop's list ran
 * **38px past the nav bar at 740x360 and 8px past it at 844x390** — a real phone in landscape — and
 * because a later camera OWNS its viewport's pixels rather than compositing over them (see this
 * module's own header), the nav bar's icons were not covered but ERASED. The modes list ran 30px
 * under its own Start button, with the third line of the first card printed beneath it.
 *
 * A floor is never the fix. If the space left is too small to be useful, the layout has to give
 * something up ABOVE the list — `Modes` drops its section heading, which the nav bar already says —
 * and if there is still nothing left, a list of nothing is the honest answer. `setBounds` floors
 * the viewport at 1px on its own, so 0 is safe to pass.
 */
export function listHeightBetween(top: number, bottom: number): number {
  return Math.max(0, bottom - top)
}

export function scrollableCameraRegion(scene: Phaser.Scene, bounds: ScrollRegionBounds): ScrollableCameraRegion {
  const camera = scene.cameras.add(bounds.x, bounds.y, Math.max(1, bounds.width), Math.max(1, bounds.height))
  return {
    camera,
    setBounds(b: ScrollRegionBounds) {
      camera.setViewport(b.x, b.y, Math.max(1, b.width), Math.max(1, b.height))
    },
    destroy() {
      scene.cameras.remove(camera)
    },
  }
}
