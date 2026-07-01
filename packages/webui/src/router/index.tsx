import {
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { AppLayout } from './app-layout';
import { ErrorPage, NotFoundPage } from '@/components/pages/status-screens';

// ─── Route tree ──────────────────────────────────────────────────────────────
// Tab-based architecture: WorkspaceView handles page rendering internally.
// A single rootRoute renders AppLayout for all URLs.

const rootRoute = createRootRoute({
  component: () => <AppLayout />,
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
