import { logError } from './yt'

export interface RecordedError {
  message: string
  stack?: string
  timestamp: number
}

const MAX_RECENT_ERRORS = 20
const recentErrors: RecordedError[] = []
const seenSignatures = new Set<string>()

/**
 * Returns the first stack *frame* (an "at ..." line), not literally the first line of
 * `.stack` — for a standard V8 Error, that first line is just `"${name}: ${message}"`,
 * which duplicates `message` and would give the signature no more discriminating power
 * than `message` alone. The first real frame is what actually distinguishes two errors
 * that happen to share a message but were thrown from different call sites.
 */
function firstStackFrame(stack: string | undefined): string {
  if (!stack) return ''
  const lines = stack.split('\n').map((line) => line.trim())
  return lines.find((line) => line.startsWith('at ')) ?? lines[0] ?? ''
}

/**
 * Records an error into the local ring buffer and, the first time this exact signature
 * (message + throw site) is seen this session, reports it once via `logError()`. The
 * platform's health API is rate-limited — a cascade of the same error firing every frame
 * (e.g. from inside `update()`) must not burn through that budget reporting the same bug
 * dozens of times.
 */
function recordError(message: string, stack?: string): void {
  recentErrors.push({ message, stack, timestamp: Date.now() })
  if (recentErrors.length > MAX_RECENT_ERRORS) {
    recentErrors.shift()
  }

  const signature = `${message}::${firstStackFrame(stack)}`
  if (!seenSignatures.has(signature)) {
    seenSignatures.add(signature)
    logError()
  }
}

/**
 * Read-only snapshot of the last `MAX_RECENT_ERRORS` errors seen this session, newest
 * last. For the dev console and future tests -- this never leaves the client. Playables
 * is an offline-only environment (its CSP blocks external network calls), so there is
 * nowhere to send detailed error payloads even if we wanted to; `logError()`'s per-session,
 * per-signature ping to the platform's own health metrics is the only outbound signal.
 */
export function getRecentErrors(): readonly RecordedError[] {
  return [...recentErrors]
}

/**
 * Wires `window.onerror`/`onunhandledrejection` into the recorder above. Call once, before
 * `new Phaser.Game(...)`, so a synchronous throw during game construction itself is still
 * caught.
 */
export function initHealthMonitoring(): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    recordError(event.message, event.error instanceof Error ? event.error.stack : undefined)
  })

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason as unknown
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    recordError(message, stack)
  })
}
