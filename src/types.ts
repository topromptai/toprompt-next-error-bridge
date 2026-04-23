/**
 * Message types posted to `window.parent` when the error bridge captures an
 * error inside the generated app's iframe.
 *
 * The parent (toPrompt IDE) listens with:
 *   window.addEventListener('message', (event) => {
 *     if (event.data?.type === '__TOPROMPT_BUILD_ERROR__') { ... }
 *   });
 */

export type ErrorBridgeMessageType =
  | '__TOPROMPT_BUILD_ERROR__'
  | '__TOPROMPT_ERROR__'
  | '__TOPROMPT_CONSOLE_ERROR__'
  | '__TOPROMPT_BRIDGE_READY__';

/**
 * Source of the captured error — tells the IDE which listener fired.
 */
export type ErrorBridgeSource =
  | 'window.onerror'
  | 'unhandledrejection'
  | 'console.error'
  | 'nextjs-overlay'
  | 'react-boundary';

/**
 * Payload shape inside every error postMessage. Fields are optional except
 * `message` and `source` because not all error sources give us file/line.
 */
export interface ErrorBridgePayload {
  /** Short human-readable error message */
  message: string;
  /** File path where error happened (parsed from stack/overlay when possible) */
  file?: string;
  /** Line number in the file */
  line?: number;
  /** Column number */
  col?: number;
  /** Full stack trace (when available) */
  stack?: string;
  /** React component stack (from ErrorBoundary or React dev warnings) */
  componentStack?: string;
  /** Error constructor name (TypeError, ChunkLoadError, ReferenceError, etc.) */
  errorName?: string;
  /** URL pathname where the error fired — lets the IDE reload to the same page to verify a fix */
  pathname?: string;
  /** Source of the capture */
  source: ErrorBridgeSource;
}

/**
 * The envelope that goes over postMessage. Parent windows should check
 * `type.startsWith('__TOPROMPT_')` before accessing fields.
 */
export interface ErrorBridgeMessage {
  type: ErrorBridgeMessageType;
  error: ErrorBridgePayload;
  timestamp: number;
  /** Bridge version so the parent can debug compat issues */
  bridgeVersion?: string;
}

/**
 * Emitted once when the bridge mounts. The IDE uses this to confirm the
 * bridge is alive and know which version / path it's running on.
 */
export interface ErrorBridgeReadyMessage {
  type: '__TOPROMPT_BRIDGE_READY__';
  bridgeVersion: string;
  pathname: string;
  userAgent: string;
  timestamp: number;
}
