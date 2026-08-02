import { PRIMARY_NAV_COUNT, type NavItem } from "@/components/nav-icons";
import { can, type SessionUser } from "@/lib/session";

/**
 * The navigation a given user should see. Shared by the app shell and the
 * mobile More page so a destination can never appear in one and not the other.
 *
 * The first four are fixed and the rest fold into More. That split is a
 * decision rather than an overflow: the tab bar should not change shape as
 * somebody gains a permission, because muscle memory is most of what a tab bar
 * is for. A tech and a manager both find Jobs in the same place.
 */

export function buildNavItems(user: SessionUser): NavItem[] {
  // Dashboard and Approvals are for everybody: an approver finds their queue
  // there, and a tech finds out they were put on a job.
  const primary: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  ];

  if (can(user, "job.view")) {
    primary.push({ href: "/jobs", label: "Jobs", icon: "jobs" });
  }
  if (can(user, "project.manage") || can(user, "job.view")) {
    primary.push({ href: "/projects", label: "Projects", icon: "projects" });
  }
  primary.push({ href: "/approvals", label: "Approvals", icon: "approvals" });

  const secondary: NavItem[] = [];
  if (can(user, "mileage.submit")) {
    secondary.push({ href: "/mileage", label: "Mileage", icon: "mileage" });
  }
  if (can(user, "payroll.view")) {
    secondary.push({ href: "/pay", label: "Pay", icon: "pay" });
  }
  if (can(user, "client.manage") || can(user, "project.manage")) {
    secondary.push({ href: "/directory", label: "Directory", icon: "directory" });
  }
  secondary.push({ href: "/account", label: "Account", icon: "account" });
  if (
    can(user, "settings.company") ||
    can(user, "users.manage") ||
    can(user, "roles.manage") ||
    can(user, "settings.integrations")
  ) {
    secondary.push({ href: "/settings", label: "Settings", icon: "settings" });
  }

  // Padded so the four primary slots hold the same four things for everybody.
  // Somebody who cannot see jobs gets a shorter bar rather than Mileage
  // sliding into the slot where Jobs lives on every other phone.
  return [...primary.slice(0, PRIMARY_NAV_COUNT), ...secondary];
}
