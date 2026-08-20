/**
 * The one place randomness is allowed to enter the game.
 *
 * `src/sim/` is forbidden from touching `Math.random` — its determinism is what the bot, the daily
 * puzzle's solvability proof and every `node`-run test are built on (CHAPAEV-PLAN.md §2). The bot
 * does need randomness, because §6 makes Gaussian noise on the chosen shot the ENTIRE difficulty
 * parameter. So it takes a generator as an argument rather than reaching for a global one, and a
 * seeded generator makes a whole tournament replayable.
 *
 * **Pure TypeScript, no Phaser**, like everything it serves.
 */

export interface Random {
  /** Uniform in `[0, 1)`. */
  next(): number
  /** Normal with mean 0 and the given standard deviation. */
  gaussian(sigma: number): number
}

/**
 * mulberry32 — small, fast, and good enough for jittering an angle. The same generator
 * `scripts/make-atlas.mjs` uses, so the project has one PRNG rather than two.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /**
   * Box–Muller. A sum-of-uniforms approximation would be cheaper, but it has no tail — and the tail
   * is exactly what an easy bot needs, because a miss should occasionally be a BAD miss. A jitter
   * that never strays far reads as a machine being slightly imprecise on purpose; a real one
   * sometimes fluffs it.
   */
  const gaussian = (sigma: number): number => {
    if (sigma <= 0) return 0
    // `1 - next()` keeps the argument off zero, where the logarithm is undefined.
    const u = 1 - next()
    const v = next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma
  }

  return { next, gaussian }
}
