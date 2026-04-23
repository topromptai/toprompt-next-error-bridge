'use client';

import { useEffect } from 'react';
import { post } from './post.js';

/**
 * Client component that installs four error listeners on mount, plus a
 * route broadcaster that forwards SPA navigations to the parent window
 * (so the parent's URL bar tracks iframe navigation and a refresh lands
 * the user back on the same page they were debugging).
 *
 *   1. window.onerror           — uncaught runtime JS errors
 *   2. unhandledrejection       — unhandled promise rejections
 *   3. console.error override   — React / library errors that only log
 *   4. MutationObserver on the Next.js <nextjs-portal> shadow DOM — Turbopack
 *      / webpack build errors that render the dev error overlay
 *   5. history.pushState / replaceState / popstate — emits `__route_change`
 *      postMessage events every time the SPA navigates, including the
 *      initial path on mount.
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

    // 5. Route-change broadcaster — posts the current path to the parent
    //    every time the SPA navigates. The parent uses this to keep its
    //    address bar in sync with the iframe AND to restore the same page
    //    after a hot-reload triggered by a code edit / fix.
    //
    //    Next.js App Router navigates via `history.pushState`, not via
    //    full page loads, so we hook that directly plus `popstate` for
    //    browser back/forward. Also fires once on mount to report the
    //    initial pathname.
    const postRoute = (): void => {
      try {
        if (typeof window === 'undefined') return;
        if (!window.parent || window.parent === window) return;
        const path =
          (window.location.pathname || '/') +
          (window.location.search || '') +
          (window.location.hash || '');
        window.parent.postMessage(
          { type: '__route_change', path, timestamp: Date.now() },
          '*',
        );
      } catch {
        // Ignore — cross-origin access or closed parent window
      }
    };

    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function (...args) {
      const ret = origPushState.apply(this, args as Parameters<typeof history.pushState>);
      // Defer one tick so `location` reflects the new URL before we read it.
      queueMicrotask(postRoute);
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = origReplaceState.apply(
        this,
        args as Parameters<typeof history.replaceState>,
      );
      queueMicrotask(postRoute);
      return ret;
    };
    const onPopState = (): void => postRoute();
    window.addEventListener('popstate', onPopState);
    // Initial route on mount — parent needs to know where we started, and this
    // doubles as the "we're alive" signal after a bridge reload.
    postRoute();

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Handle the case where the overlay is already mounted on first render
    const existingOverlay = document.querySelector('nextjs-portal');
    if (existingOverlay) pollOverlayShadowRoot(existingOverlay);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('popstate', onPopState);
      history.pushState = origPushState;
      history.replaceState = origReplaceState;
      observer.disconnect();
      console.error = origConsoleError;
    };
  }, []);

  return null;
}
