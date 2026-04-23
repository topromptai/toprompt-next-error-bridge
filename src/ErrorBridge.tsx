'use client';

import { useEffect } from 'react';
import { post, postReady } from './post.js';

/**
 * Client component that installs a complete error + navigation + inspector
 * bridge between the preview iframe and the parent IDE. Drop it near the
 * top of your root layout (once). It renders nothing.
 *
 * Captures:
 *   1. window.onerror           — uncaught runtime JS errors
 *   2. unhandledrejection       — unhandled promise rejections
 *   3. console.error override   — React / library errors, incl. stack + component stack
 *   4. Next.js <nextjs-portal>  — Turbopack/webpack build errors (parses file:line:col)
 *
 * Broadcasts:
 *   5. history.pushState/replaceState/popstate/hashchange → `__route_change`
 *      so the parent's URL bar tracks iframe navigation and refresh lands on
 *      the same page.
 *   6. `__TOPROMPT_BRIDGE_READY__` once on mount — parent uses this to know the
 *      bridge is alive, its version, and the initial path.
 *
 * Listens:
 *   7. `__inspector_toggle` → when active, clicks send `__element_selected` so
 *      the IDE can enter a click-to-inspect / click-to-edit mode.
 *
 * Usage:
 *   <body>
 *     <ErrorBridge />
 *     <ErrorBoundary>{children}</ErrorBoundary>
 *   </body>
 */
export function ErrorBridge(): null {
  useEffect(() => {
    // ─────────────────────────────────────────────────────────────────────
    // 1. Uncaught runtime errors
    // ─────────────────────────────────────────────────────────────────────
    const onError = (event: ErrorEvent) => {
      const errorName =
        (event.error && typeof event.error === 'object' && (event.error as Error).name) ||
        undefined;
      post('__TOPROMPT_ERROR__', {
        message: event.message || 'Unknown error',
        file: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: event.error?.stack,
        errorName,
        source: 'window.onerror',
      });
    };

    // ─────────────────────────────────────────────────────────────────────
    // 2. Unhandled promise rejections
    // ─────────────────────────────────────────────────────────────────────
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      const isErr = reason instanceof Error;
      const message = isErr
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
        stack: isErr ? reason.stack : undefined,
        errorName: isErr ? reason.name : undefined,
        source: 'unhandledrejection',
      });
    };

    // ─────────────────────────────────────────────────────────────────────
    // 3. console.error override — extracts stack from Error args and React's
    //    componentStack when present (React's internal pattern is
    //    `console.error("…message with %s…", props, errorObject)`).
    // ─────────────────────────────────────────────────────────────────────
    const origConsoleError = console.error;
    console.error = function (...args: unknown[]) {
      try {
        // First Error instance gives us the real stack
        const firstError = args.find((a): a is Error => a instanceof Error);
        // React-style componentStack — look for an object arg with a
        // `componentStack` string field (React 18/19 devtools pattern).
        const compStackObj = args.find(
          (a): a is { componentStack: string } =>
            typeof a === 'object' &&
            a !== null &&
            typeof (a as { componentStack?: unknown }).componentStack === 'string',
        );
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
        post('__TOPROMPT_CONSOLE_ERROR__', {
          message,
          stack: firstError?.stack,
          errorName: firstError?.name,
          componentStack: compStackObj?.componentStack,
          source: 'console.error',
        });
      } catch {
        // Never let the bridge itself throw
      }
      // eslint-disable-next-line prefer-rest-params
      origConsoleError.apply(console, args as any);
    };

    // ─────────────────────────────────────────────────────────────────────
    // 4. Next.js error overlay observer — parses file:line:col from the text
    //    so downstream consumers don't have to scrape it themselves.
    //    Overlay text always contains "./src/app/foo.tsx:12:34" format.
    // ─────────────────────────────────────────────────────────────────────
    const parseOverlayLocation = (
      text: string,
    ): { file?: string; line?: number; col?: number } => {
      if (!text) return {};
      const m = text.match(
        /(?:^|\s|\()(?:\.\/|\/)?((?:src|app)\/[^\s:()`'"]+\.(?:tsx?|jsx?|mjs|cjs|css)):(\d+)(?::(\d+))?/m,
      );
      if (!m) return {};
      const [, file, line, col] = m;
      return {
        file,
        line: Number.isFinite(Number(line)) ? Number(line) : undefined,
        col: col && Number.isFinite(Number(col)) ? Number(col) : undefined,
      };
    };

    const pollOverlayShadowRoot = (portal: Element): void => {
      const sr = (portal as unknown as { shadowRoot: ShadowRoot | null }).shadowRoot;
      if (!sr) {
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
        const rawText = body.textContent.trim().slice(0, 5000); // bumped from 2k
        const loc = parseOverlayLocation(rawText);
        post('__TOPROMPT_BUILD_ERROR__', {
          message: rawText,
          file: loc.file,
          line: loc.line,
          col: loc.col,
          source: 'nextjs-overlay',
        });
      }
    };

    const observer = new MutationObserver(() => {
      const overlay = document.querySelector('nextjs-portal');
      if (overlay) pollOverlayShadowRoot(overlay);
    });

    // ─────────────────────────────────────────────────────────────────────
    // 5. Route broadcaster — mirrors iframe SPA navigation to the parent.
    //    Hooks history.pushState, replaceState, popstate, and hashchange.
    // ─────────────────────────────────────────────────────────────────────
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
        // Ignore
      }
    };

    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function (...args) {
      const ret = origPushState.apply(this, args as Parameters<typeof history.pushState>);
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
    const onHashChange = (): void => postRoute();
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);

    // ─────────────────────────────────────────────────────────────────────
    // 7. Inspector mode — when the parent sends `__inspector_toggle`, attach
    //    a click listener that captures target element info and posts it
    //    back as `__element_selected`. Toggled off when not active so we
    //    don't interfere with normal app clicks.
    // ─────────────────────────────────────────────────────────────────────
    let inspectorActive = false;
    let inspectorMoveEl: HTMLElement | null = null;
    const INSPECTOR_OUTLINE = '2px dashed rgba(99, 102, 241, 0.8)';

    const clearInspectorOutline = (): void => {
      if (inspectorMoveEl) {
        inspectorMoveEl.style.outline = inspectorMoveEl.dataset.__topromptPrevOutline || '';
        delete inspectorMoveEl.dataset.__topromptPrevOutline;
        inspectorMoveEl = null;
      }
    };

    const buildSelector = (el: Element): string => {
      if (!(el instanceof Element)) return '';
      if (el.id) return `#${el.id}`;
      const tag = el.tagName.toLowerCase();
      const cls = typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
      return `${tag}${cls}`;
    };

    const onInspectorMove = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target || target === inspectorMoveEl) return;
      clearInspectorOutline();
      inspectorMoveEl = target;
      target.dataset.__topromptPrevOutline = target.style.outline || '';
      target.style.outline = INSPECTOR_OUTLINE;
    };

    const onInspectorClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        window.parent.postMessage(
          {
            type: '__element_selected',
            tag: target.tagName.toLowerCase(),
            text: (target.textContent || '').trim().slice(0, 200),
            classes: typeof target.className === 'string' ? target.className : '',
            selector: buildSelector(target),
            pathname:
              (window.location.pathname || '/') +
              (window.location.search || '') +
              (window.location.hash || ''),
          },
          '*',
        );
      } catch {
        // Ignore
      }
    };

    const enableInspector = (): void => {
      if (inspectorActive) return;
      inspectorActive = true;
      document.body.style.cursor = 'crosshair';
      document.addEventListener('mousemove', onInspectorMove, true);
      document.addEventListener('click', onInspectorClick, true);
    };

    const disableInspector = (): void => {
      if (!inspectorActive) return;
      inspectorActive = false;
      document.body.style.cursor = '';
      clearInspectorOutline();
      document.removeEventListener('mousemove', onInspectorMove, true);
      document.removeEventListener('click', onInspectorClick, true);
    };

    const onParentMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string; active?: boolean } | null;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (data.type === '__inspector_toggle') {
        if (data.active) enableInspector();
        else disableInspector();
      }
    };
    window.addEventListener('message', onParentMessage);

    // Register global listeners
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Initial state broadcasts
    const existingOverlay = document.querySelector('nextjs-portal');
    if (existingOverlay) pollOverlayShadowRoot(existingOverlay);
    postRoute();   // initial path
    postReady();   // "bridge alive" ping

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('message', onParentMessage);
      history.pushState = origPushState;
      history.replaceState = origReplaceState;
      disableInspector();
      observer.disconnect();
      console.error = origConsoleError;
    };
  }, []);

  return null;
}
