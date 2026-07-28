import {
  Car,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
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
