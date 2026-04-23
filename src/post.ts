/**
 * Shared dedupe + postMessage helper used by both ErrorBridge and ErrorBoundary.
 * Keeps the last ~50 keys (type + first 150 chars of message) for a 2s window
 * so rapid-fire duplicates (e.g. React StrictMode double-fire) collapse.
 */

import type { ErrorBridgeMessageType, ErrorBridgeMessage, ErrorBridgePayload } from './types.js';

const DEDUPE_WINDOW_MS = 2000;
const MAX_DEDUPE_ENTRIES = 50;

const recentKeys = new Map<string, number>();

function prune(now: number): void {
  if (recentKeys.size <= MAX_DEDUPE_ENTRIES) return;
  for (const [k, t] of recentKeys) {
    if (now - t > DEDUPE_WINDOW_MS * 5) recentKeys.delete(k);
  }
}

export function post(type: ErrorBridgeMessageType, error: ErrorBridgePayload): void {
  const key = `${type}:${error.message.slice(0, 150)}`;
  const now = Date.now();
  const lastSeen = recentKeys.get(key);
  if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) return;
  recentKeys.set(key, now);
  prune(now);

  try {
    if (typeof window === 'undefined') return;
    if (window.parent && window.parent !== window) {
      const msg: ErrorBridgeMessage = { type, error, timestamp: now };
      window.parent.postMessage(msg, '*');
    }
  } catch {
    // Cross-origin lockdown or frozen window — swallow; app doesn't need to know
  }
}
