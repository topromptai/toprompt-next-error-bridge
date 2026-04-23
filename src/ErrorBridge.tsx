'use client';

import { useEffect } from 'react';
import { post } from './post.js';

/**
 * Client component that installs four error listeners on mount:
 *
 *   1. window.onerror           — uncaught runtime JS errors
 *   2. unhandledrejection       — unhandled promise rejections
 *   3. console.error override   — React / library errors that only log
 *   4. MutationObserver on the Next.js <nextjs-portal> shadow DOM — Turbopack
 *      / webpack build errors that render the dev error overlay
 *
 * Drop it near the top of your root layout (once). It renders nothing.
 *
 *   <body>
 *     <ErrorBridge />
 *     <ErrorBoundary>{children}</ErrorBoundary>
 *   </body>
 */
export function ErrorBridge(): null {
  useEffect(() => {
    // 1. Uncaught runtime errors
    const onError = (event: ErrorEvent) => {
      post('__TOPROMPT_ERROR__', {
        message: event.message || 'Unknown error',
        file: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: event.error?.stack,
        source: 'window.onerror',
      });
    };

    // 2. Unhandled promise rejections
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : (() => {
                try {
                  return JSON.stringify(reason);
                } catch {
                  return String(reason);
                }
              })();
      post('__TOPROMPT_ERROR__', {
        message: message || 'Unhandled promise rejection',
        stack: reason instanceof Error ? reason.stack : undefined,
        source: 'unhandledrejection',
      });
    };

    // 3. console.error override — catches React warnings + library errors
    const origConsoleError = console.error;
    console.error = function (...args: unknown[]) {
      try {
        const message = args
          .map((a) => {
            if (a instanceof Error) return a.message;
            if (typeof a === 'string') return a;
            try {
              return JSON.stringify(a).slice(0, 500);
            } catch {
              return String(a);
            }
          })
          .join(' ');
        post('__TOPROMPT_CONSOLE_ERROR__', { message, source: 'console.error' });
      } catch {
        // Never let the bridge itself throw
      }
      // eslint-disable-next-line prefer-rest-params
      origConsoleError.apply(console, args as any);
    };

    // 4. Next.js error overlay observer (Turbopack + webpack dev)
    //    Next.js renders errors inside a shadow-dom <nextjs-portal> element.
    const pollOverlayShadowRoot = (portal: Element): void => {
      const sr = (portal as unknown as { shadowRoot: ShadowRoot | null }).shadowRoot;
      if (!sr) {
        // Shadow root may not be attached yet — retry once
        setTimeout(() => {
          const retry = (portal as unknown as { shadowRoot: ShadowRoot | null }).shadowRoot;
          if (retry) extractAndPost(retry);
        }, 100);
        return;
      }
      extractAndPost(sr);
    };

    const extractAndPost = (sr: ShadowRoot): void => {
      const body = sr.querySelector('[data-nextjs-dialog-body]');
      if (body?.textContent) {
        post('__TOPROMPT_BUILD_ERROR__', {
          message: body.textContent.trim().slice(0, 2000),
          source: 'nextjs-overlay',
        });
      }
    };

    const observer = new MutationObserver(() => {
      const overlay = document.querySelector('nextjs-portal');
      if (overlay) pollOverlayShadowRoot(overlay);
    });

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Handle the case where the overlay is already mounted on first render
    const existingOverlay = document.querySelector('nextjs-portal');
    if (existingOverlay) pollOverlayShadowRoot(existingOverlay);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      observer.disconnect();
      console.error = origConsoleError;
    };
  }, []);

  return null;
}
