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
  | '__TOPROMPT_CONSOLE_ERROR__';

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
 * Payload shape inside every postMessage. Fields are optional except
 * `message` and `source` because not all error sources give us file/line.
 */
export interface ErrorBridgePayload {
  message: string;
  file?: string;
  line?: number;
  col?: number;
  stack?: string;
  componentStack?: string;
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
}
