import type { ReactNode } from "react";
import { Navigate, createMemoryRouter, useLocation, type RouteObject } from "react-router";
import { RAIL, TAB, routeFor } from "@/shared/config/routes";
import { registerNavigator } from "@/shared/lib/navigator";
import { PageMotion } from "@/shared/ui/PageMotion";
import { FriendsPage } from "@/pages/friends";
import { HomePage } from "@/pages/home";
import { InstallationsPage } from "@/pages/installations";
import { NetworkPage } from "@/pages/network";
import { JavaPackPage, ReminedVanillaPage, VanillaPage } from "@/pages/pack";
import { ProfilePage } from "@/pages/profile";
import { ScreenshotsPage } from "@/pages/screenshots";
import { SettingsPage } from "@/pages/settings";
import { VoicePage } from "@/pages/voice";
import { RouteError } from "./RouteError";
import { ShellLayout } from "./ShellLayout";

/** Cross-fades content when the location changes. */
function Motion({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <PageMotion viewKey={pathname}>{children}</PageMotion>;
}

/** Friends / Network / Voice are available on every rail that shows tabs. */
const socialRoutes: RouteObject[] = [
  { path: TAB.friends, element: <Motion><FriendsPage /></Motion> },
  { path: TAB.network, element: <Motion><NetworkPage /></Motion> },
  { path: TAB.voice, element: <VoicePage /> },
];

const packRoutes = (page: ReactNode): RouteObject[] => [
  { index: true, element: page },
  { path: TAB.screenshots, element: <Motion><ScreenshotsPage /></Motion> },
  ...socialRoutes,
];

const home = routeFor(RAIL.home);

export const router = createMemoryRouter(
  [
    {
      path: "/",
      element: <ShellLayout />,
      errorElement: <RouteError />,
      children: [
        { index: true, element: <Navigate to={home} replace /> },
        {
          path: RAIL.home,
          children: [{ index: true, element: <HomePage /> }, ...socialRoutes],
        },
        { path: RAIL.java, children: packRoutes(<JavaPackPage />) },
        { path: RAIL.vanilla, children: packRoutes(<VanillaPage />) },
        { path: RAIL.reminedVanilla, children: packRoutes(<ReminedVanillaPage />) },
        { path: RAIL.installations, element: <Motion><InstallationsPage /></Motion> },
        { path: RAIL.settings, element: <Motion><SettingsPage /></Motion> },
        { path: RAIL.profile, element: <Motion><ProfilePage /></Motion> },
        { path: "*", element: <Navigate to={home} replace /> },
      ],
    },
  ],
  { initialEntries: [home] },
);

// Let non-component code (feature actions) navigate.
registerNavigator({
  navigate: (to) => void router.navigate(to),
  pathname: () => router.state.location.pathname,
});
