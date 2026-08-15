import { loadData as ytLoadData, saveData as ytSaveData, logError, logWarning } from '../platform/yt'
import { migrate } from './migrate'
import { DEFAULT_SAVE_STATE, SaveState } from './types'

// ytgame.game.saveData()'s hard limit — exceeding it rejects with SIZE_LIMIT_EXCEEDED.
const SAVE_SIZE_LIMIT_BYTES = 3 * 1024 * 1024
const SAVE_SIZE_WARN_RATIO = 0.8

/**
 * Loads and migrates the persisted SaveState. Never throws: an empty string (no save
 * yet, or a signed-out YouTube user — both valid), corrupt JSON, and an unrecognized
 * schema version all fall back to DEFAULT_SAVE_STATE with a console.warn.
 */
export async function load(): Promise<SaveState> {
  let raw: string
  try {
    raw = await ytLoadData()
  } catch (e) {
    console.warn('[save] loadData() failed, using defaults', e)
    logError()
    return { ...DEFAULT_SAVE_STATE }
  }

  if (raw === '') {
    return { ...DEFAULT_SAVE_STATE }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    console.warn('[save] corrupt save JSON, using defaults', e)
    return { ...DEFAULT_SAVE_STATE }
  }

  const migrated = migrate(parsed)
  if (!migrated) {
    console.warn('[save] unrecognized save schema, using defaults')
    return { ...DEFAULT_SAVE_STATE }
  }

  return migrated
}

/** Serializes and persists a SaveState. Skips (with a warning) rather than throwing on bad input. */
export async function save(state: SaveState): Promise<void> {
  const json = JSON.stringify(state)

  // isWellFormed() is ES2024; tsconfig's lib covers the type, but this build may end up
  // reused on a platform/browser old enough to lack the runtime method, so feature-detect
  // rather than assume — esbuild doesn't polyfill methods, only syntax.
  const isWellFormed = typeof json.isWellFormed === 'function' ? json.isWellFormed() : true
  if (!isWellFormed) {
    console.warn('[save] serialized save is not well-formed UTF-16, aborting save')
    logWarning()
    return
  }

  // JS strings are UTF-16 internally; approximate the SDK's byte limit as 2 bytes/code unit.
  const byteSize = json.length * 2
  if (byteSize > SAVE_SIZE_LIMIT_BYTES) {
    console.warn(`[save] save payload is ${byteSize} bytes, over the ${SAVE_SIZE_LIMIT_BYTES}-byte SDK limit — aborting save`)
    logWarning()
    return
  }
  if (byteSize > SAVE_SIZE_LIMIT_BYTES * SAVE_SIZE_WARN_RATIO) {
    console.warn(`[save] save payload is ${((byteSize / SAVE_SIZE_LIMIT_BYTES) * 100).toFixed(0)}% of the SDK size limit`)
  }

  try {
    await ytSaveData(json)
  } catch (e) {
    console.warn('[save] saveData() failed', e)
    logError()
  }
}
