/**
 * Route model of the launcher. The router (`app/router`) is built from this;
 * widgets and features use the helpers to build links and read the location.
 *
 *   /home[/friends|network|voice]
 *   /java|vanilla|remined-vanilla[/screenshots|friends|network|voice]
 *   /installations  /settings  /profile
 */
export const RAIL = {
  home: "home",
  java: "java",
  vanilla: "vanilla",
  reminedVanilla: "remined-vanilla",
  installations: "installations",
  settings: "settings",
  profile: "profile",
} as const;

export type Rail = (typeof RAIL)[keyof typeof RAIL];

/** Rails that launch a game edition (they get the playbar and the Shots tab). */
export const PACK_RAILS = [RAIL.java, RAIL.vanilla, RAIL.reminedVanilla] as const;
export type PackRail = (typeof PACK_RAILS)[number];

export const TAB = {
  /** Index route of a rail: home landing / pack page. */
  play: "play",
  screenshots: "screenshots",
  friends: "friends",
  network: "network",
  voice: "voice",
} as const;

export type Tab = (typeof TAB)[keyof typeof TAB];

export const TAB_LABEL: Record<Tab, string> = {
  play: "Play",
  screenshots: "Shots",
  friends: "Friends",
  network: "Network",
  voice: "Voice",
};

const SOCIAL_TABS: readonly Tab[] = [TAB.friends, TAB.network, TAB.voice];

/** Tabs shown in the top nav per rail (empty = no tab strip). */
export const RAIL_TABS: Record<Rail, readonly Tab[]> = {
  [RAIL.home]: SOCIAL_TABS,
  [RAIL.java]: [TAB.play, TAB.screenshots, ...SOCIAL_TABS],
  [RAIL.vanilla]: [TAB.play, TAB.screenshots, ...SOCIAL_TABS],
  [RAIL.reminedVanilla]: [TAB.play, TAB.screenshots, ...SOCIAL_TABS],
  [RAIL.installations]: [],
  [RAIL.settings]: [],
  [RAIL.profile]: [],
};

export const ROUTE_ROOT = "/";

export function isPackRail(rail: Rail): rail is PackRail {
  return (PACK_RAILS as readonly Rail[]).includes(rail);
}

/** `/<rail>` for the index tab, `/<rail>/<tab>` otherwise. */
export function routeFor(rail: Rail, tab: Tab = TAB.play): string {
  return tab === TAB.play ? `/${rail}` : `/${rail}/${tab}`;
}

const RAILS = Object.values(RAIL) as Rail[];
const TABS = Object.values(TAB) as Tab[];

export function parseRoute(pathname: string): { rail: Rail; tab: Tab } {
  const [first, second] = pathname.split("/").filter(Boolean);
  const rail = RAILS.find((r) => r === first) ?? RAIL.home;
  const tab = TABS.find((t) => t === second) ?? TAB.play;
  return { rail, tab };
}
