/**
 * How far the top HUD keeps away from the top edge (CONCEPT.md §8/S12).
 *
 * A Playables game runs inside a YouTube iframe on someone else's phone: a notch, a status bar or
 * the host's own chrome can overlap the first few dozen pixels of the viewport, and anything the
 * player must be able to TAP up there — the settings gear, the coin balance — becomes unreachable
 * rather than merely ugly. The margin is a fixed budget rather than a reading of
 * `env(safe-area-inset-top)`: inside a cross-origin iframe that value is frequently 0 even when the
 * host is overlapping content, so trusting it would leave exactly the devices this protects
 * unprotected.
 *
 * The extra portrait allowance is where the intrusions actually are. In landscape a phone's notch
 * is on the side, and vertical space is the scarce resource — spending 54px of it would push the
 * board down for no benefit.
 */
export const SAFE_AREA_TOP_MARGIN_PX = 24
export const SAFE_AREA_TOP_PORTRAIT_EXTRA_PX = 30

/** Top margin for this viewport, in CSS pixels. Portrait is `height > width` — the same test the
 * rest of the layout code uses, not a device query. */
export function safeAreaTop(width: number, height: number): number {
  return SAFE_AREA_TOP_MARGIN_PX + (height > width ? SAFE_AREA_TOP_PORTRAIT_EXTRA_PX : 0)
}
