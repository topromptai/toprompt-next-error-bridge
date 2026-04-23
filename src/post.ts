/**
 * Shared dedupe + postMessage helper used by both ErrorBridge and ErrorBoundary.
 *
 * Dedupe key = type + first 500 chars of message + line + col. 500 chars
 * preserves enough detail to distinguish adjacent errors that share a prefix
 * (e.g. two different "Cannot read properties of undefined" with different
 * property names). A 2-second window collapses rapid-fire duplicates like
 * React StrictMode double-fires.
 */

import type {
  ErrorBridgeMessageType,
  ErrorBridgeMessage,
  ErrorBridgePayload,
} from './types.js';
import { BRIDGE_VERSION } from './version.js';

const DEDUPE_WINDOW_MS = 2000;
const MAX_DEDUPE_ENTRIES = 50;

const recentKeys = new Map<string, number>();

function prune(now: number): void {
  if (recentKeys.size <= MAX_DEDUPE_ENTRIES) return;
  for (const [k, t] of recentKeys) {
    if (now - t > DEDUPE_WINDOW_MS * 5) recentKeys.delete(k);
  }
}

function currentPathname(): string | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    return (
      (window.location.pathname || '/') +
      (window.location.search || '') +
      (window.location.hash || '')
    );
  } catch {
    return undefined;
  }
}

export function post(type: ErrorBridgeMessageType, error: ErrorBridgePayload): void {
  // Build a richer dedup key — just the message prefix was too coarse.
  const key =
    `${type}:${(error.message || '').slice(0, 500)}:` +
    `${error.file ?? ''}:${error.line ?? ''}:${error.col ?? ''}`;
  const now = Date.now();
  const lastSeen = recentKeys.get(key);
  if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) return;
  recentKeys.set(key, now);
  prune(now);

  // Attach pathname if the caller didn't supply one.
  const enriched: ErrorBridgePayload =
    error.pathname === undefined ? { ...error, pathname: currentPathname() } : error;

  try {
    if (typeof window === 'undefined') return;
    if (window.parent && window.parent !== window) {
      const msg: ErrorBridgeMessage = {
        type,
        error: enriched,
        timestamp: now,
        bridgeVersion: BRIDGE_VERSION,
      };
      window.parent.postMessage(msg, '*');
    }
  } catch {
    // Cross-origin lockdown or frozen window — swallow
  }
}

/**
 * Ready / heartbeat signal. Fires once on mount so the parent IDE can confirm
 * the bridge script evaluated and know its version and initial path.
 */
export function postReady(): void {
  try {
    if (typeof window === 'undefined') return;
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage(
      {
        type: '__TOPROMPT_BRIDGE_READY__',
        bridgeVersion: BRIDGE_VERSION,
        pathname: currentPathname() || '/',
        userAgent: navigator.userAgent,
        timestamp: Date.now(),
      },
      '*',
    );
  } catch {
    // Ignore
  }
}
