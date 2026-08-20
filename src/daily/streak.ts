/**
 * §7's streak — the reason a daily is a daily and not a puzzle mode.
 *
 * **Pure TypeScript, no Phaser**, and no clock either: the current date is passed in. Everything
 * here is a function of "what does the save say" and "what day is it", which is the only way the
 * roll-over rules are testable at all — a streak bug that only appears at midnight is a bug nobody
 * ever reproduces.
 */
import { getState, mutate } from '../save/store'
import type { SavedDaily } from '../save/types'

/** Days between two `YYYY-MM-DD` keys. Negative if `later` is earlier. */
export function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`)
  const b = Date.parse(`${later}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86400000)
}

export interface DailyStatus {
  streak: number
  best: number
  /** Today's puzzle has already been solved. */
  solvedToday: boolean
  /** The streak will be lost if today is missed — true once a day has gone by unsolved. */
  atRisk: boolean
}

/**
 * The daily state as of `today`, with a lapsed streak already zeroed.
 *
 * Reading is where the roll-over happens rather than writing, because the game is far more often
 * opened than played: a streak that only resets when you next solve a puzzle would show yesterday's
 * number for weeks.
 */
export function dailyStatus(today: string): DailyStatus {
  const saved = getState().daily
  const gap = saved.lastPlayed ? daysBetween(saved.lastPlayed, today) : Number.POSITIVE_INFINITY

  // Same day: nothing has moved. One day: the streak is alive and today is unplayed. More: it has
  // lapsed.
  const streak = gap === 0 ? saved.streak : gap === 1 ? saved.streak : 0

  return {
    streak,
    best: saved.best,
    solvedToday: gap === 0 && saved.solvedToday,
    atRisk: streak > 0 && gap !== 0,
  }
}

/**
 * Records a solved daily.
 *
 * A second solve on the same day is deliberately a no-op rather than an error: the scene will not
 * offer today's puzzle twice, but a reload mid-celebration should not be able to inflate a streak.
 */
export function recordDailySolved(today: string): DailyStatus {
  const before = dailyStatus(today)
  if (before.solvedToday) return before

  const streak = before.streak + 1
  const next: SavedDaily = {
    lastPlayed: today,
    streak,
    best: Math.max(streak, before.best),
    solvedToday: true,
  }

  mutate((state) => {
    state.daily = next
  })

  return { streak: next.streak, best: next.best, solvedToday: true, atRisk: false }
}

/**
 * Records a failed attempt.
 *
 * §7 mentions "repairing a missed day" as an existing mechanic worth carrying over; this build does
 * not have one, so a failure simply leaves the day unsolved and the player may try again. What it
 * must NOT do is count as playing — that would let a deliberate miss hold a streak open.
 */
export function recordDailyFailed(): void {
  // Nothing is written. Named and documented rather than absent, so the next person does not add a
  // write here without noticing what it would allow.
}
