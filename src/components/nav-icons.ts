import {
  Car,
  CircleUser,
  ClipboardList,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Layers,
  Settings,
  Wallet,
} from "lucide-react";

/**
 * Kept out of app-nav.tsx on purpose. That file is "use client", and a value
 * imported from a client module into a Server Component arrives as a reference
 * proxy rather than the component itself — rendering it throws "element type is
 * invalid". Both sides import the map from here instead.
 */
export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  jobs: ClipboardList,
  projects: Layers,
  approvals: Inbox,
  account: CircleUser,
  directory: FolderKanban,
  mileage: Car,
  pay: Wallet,
  settings: Settings,
} as const;

export type NavIcon = keyof typeof NAV_ICONS;

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
};

/** How many destinations live in the tab bar itself before More. */
export const PRIMARY_NAV_COUNT = 4;

/**
 * What the bar shows, and what More holds.
 *
 * Lives here rather than in lib/nav for the same reason the icon map does:
 * app-nav.tsx is a client component, and lib/nav reaches session and then the
 * database. Importing it from the client pulls pg into the browser bundle.
 */
export function splitNav(items: NavItem[]): {
  primary: NavItem[];
  overflow: NavItem[];
} {
  return {
    primary: items.slice(0, PRIMARY_NAV_COUNT),
    overflow: items.slice(PRIMARY_NAV_COUNT),
  };
}
