import { useLocation } from "react-router";
import { parseRoute, type Rail, type Tab } from "@/shared/config/routes";

/** Current rail + tab, derived from the router location. */
export function useRoute(): { rail: Rail; tab: Tab; pathname: string } {
  const { pathname } = useLocation();
  return { ...parseRoute(pathname), pathname };
}

export function useRail(): Rail {
  return useRoute().rail;
}
