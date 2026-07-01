import { lazy, Suspense } from 'react';
import {
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { AppLayout } from './app-layout';
import { ErrorPage, NotFoundPage } from '@/components/pages/status-screens';

const VncViewPage = lazy(() =>
  import('@/components/pages/vnc-view-page').then((m) => ({ default: m.VncViewPage })),
);

// ─── Route tree ──────────────────────────────────────────────────────────────
// Main app renders through AppLayout (no child routes — tabs manage pages).
// VNC view is handled by path detection: /processes/vnc/* loads VncViewPage
// directly without the MainLayout shell.

const rootRoute = createRootRoute({
  component: () => {
    if (window.location.pathname.startsWith('/processes/vnc/')) {
      return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-muted-foreground">加载中...</div>}>
          <VncViewPage />
        </Suspense>
      );
    }
    return <AppLayout />;
  },
});

const routeTree = rootRoute.addChildren([]);

export const appRouter = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultNotFoundComponent: () => <NotFoundPage />,
  defaultErrorComponent: ({ error, reset }) => <ErrorPage error={error} reset={reset} />,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof appRouter;
  }
}

// ─── Settings sub-tab types (kept for settings-page compatibility) ────────────
export const SETTINGS_TABS = ['appearance', 'data', 'advanced', 'account', 'system', 'notifications', 'about'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

// Settings route path constant (used by settings-page for ?tab= deep links).
export const SETTINGS_PATH = '/settings' as const;

/** Paths registered on the layout — single source of truth for nav metadata. */
export type AppPath = '/' | '/processes' | '/config' | '/logs' | '/debug' | '/settings';
