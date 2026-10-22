import { transitionTo } from "./pageTransition";

/**
 * Bridge that lets non-component code (feature actions) navigate without
 * importing the router. `app/router` registers the real implementation.
 */
type Navigator = {
  navigate: (to: string) => void;
  pathname: () => string;
};

let current: Navigator | null = null;

export function registerNavigator(nav: Navigator): void {
  current = nav;
}

export function navigateTo(to: string): void {
  if (current) transitionTo(to);
}

export function currentPathname(): string {
  return current?.pathname() ?? "/";
}
