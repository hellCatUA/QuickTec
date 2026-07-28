import type { NavItem } from "@/components/nav-icons";
import { can, type SessionUser } from "@/lib/session";

/**
 * The navigation a given user should see. Shared by the app shell and the
 * mobile More page so a destination can never appear in one and not the other.
 *
 * Order matters: the phone tab bar keeps the first few and folds the rest into
 * More, so the things a tech touches on site come first.
 */
export function buildNavItems(user: SessionUser): NavItem[] {
  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  ];

  if (can(user, "job.view")) {
    items.push({ href: "/jobs", label: "Jobs", icon: "jobs" });
  }
  if (can(user, "mileage.submit")) {
    items.push({ href: "/mileage", label: "Mileage", icon: "mileage" });
  }
  if (can(user, "payroll.view")) {
    items.push({ href: "/pay", label: "Pay", icon: "pay" });
  }
  if (can(user, "client.manage") || can(user, "project.manage")) {
    items.push({ href: "/directory", label: "Directory", icon: "directory" });
  }
  if (
    can(user, "settings.company") ||
    can(user, "users.manage") ||
    can(user, "roles.manage") ||
    can(user, "settings.integrations")
  ) {
    items.push({ href: "/settings", label: "Settings", icon: "settings" });
  }

  return items;
}
