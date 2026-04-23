# @toprompt/next-error-bridge

Error bridge for Next.js apps — forwards runtime, build, console, and React render errors from an iframe preview to the parent window via `postMessage`. Designed for AI coding environments like [toPrompt](https://toprompt.ai) that need to catch errors inside a user-generated app and surface them back to the IDE.

## What it does

Installs four error listeners inside your generated app:

| Source | Listener | Posted as |
|---|---|---|
| Uncaught runtime errors | `window.onerror` | `__TOPROMPT_ERROR__` |
| Unhandled promise rejections | `unhandledrejection` | `__TOPROMPT_ERROR__` |
| Library / React warnings | `console.error` override | `__TOPROMPT_CONSOLE_ERROR__` |
| Next.js dev error overlay (Turbopack / webpack) | `MutationObserver` on `<nextjs-portal>` shadow DOM | `__TOPROMPT_BUILD_ERROR__` |
| React render errors with component stack | `componentDidCatch` on `<ErrorBoundary>` | `__TOPROMPT_ERROR__` (source: `react-boundary`) |

All errors are posted to `window.parent` via `postMessage`. The parent (IDE) listens for messages starting with `__TOPROMPT_`.

## Install

```bash
npm install @toprompt/next-error-bridge
# or
pnpm add @toprompt/next-error-bridge
```

## Usage

In your root layout (`src/app/layout.tsx`):

```tsx
import { ErrorBridge, ErrorBoundary } from '@toprompt/next-error-bridge';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ErrorBridge />
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
```

That's it. No config required.

### Custom fallback UI

```tsx
<ErrorBoundary
  fallback={
    <div>
      <h1>Whoops</h1>
      <p>Something broke — our team has been notified.</p>
    </div>
  }
>
  {children}
</ErrorBoundary>
```

If you omit `fallback`, a minimal red error card is rendered by default.

## Parent-window listener example

```js
window.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return;
  const { type, error, timestamp } = event.data;

  if (type === '__TOPROMPT_BUILD_ERROR__') {
    console.log('Build error:', error.message, error.file, error.line);
  } else if (type === '__TOPROMPT_ERROR__') {
    console.log('Runtime error:', error.message);
    if (error.source === 'react-boundary') {
      console.log('React component stack:', error.componentStack);
    }
  } else if (type === '__TOPROMPT_CONSOLE_ERROR__') {
    console.log('Console error:', error.message);
  }
});
```

## Message format

```ts
interface ErrorBridgeMessage {
  type: '__TOPROMPT_BUILD_ERROR__' | '__TOPROMPT_ERROR__' | '__TOPROMPT_CONSOLE_ERROR__';
  error: {
    message: string;
    file?: string;
    line?: number;
    col?: number;
    stack?: string;
    componentStack?: string;
    source:
      | 'window.onerror'
      | 'unhandledrejection'
      | 'console.error'
      | 'nextjs-overlay'
      | 'react-boundary';
  };
  timestamp: number;
}
```

## Dedupe

Duplicate messages (same `type` + first 150 chars of `message`) within a 2-second window are suppressed. This handles React StrictMode double-renders and rapid-fire error loops.

## Works standalone

If the app is not running inside an iframe (`window.parent === window`), `postMessage` is skipped silently. The bridge is a no-op in that case, which means you can ship it in production without breaking anything.

## TypeScript

Full type exports:

```ts
import type {
  ErrorBridgeMessage,
  ErrorBridgeMessageType,
  ErrorBridgePayload,
  ErrorBridgeSource,
} from '@toprompt/next-error-bridge';
```

## License

MIT
