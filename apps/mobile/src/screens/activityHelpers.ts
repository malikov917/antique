import type { AuthRole } from "@antique/types";

export type ActivityFilter = "all" | "buyer" | "seller";

export function formatRelativeTime(dateString: string, nowRef?: Date): string {
  const date = new Date(dateString);
  const now = nowRef ?? new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return "Just now";
  }
  if (diffMin < 60) {
    return `${diffMin} min ago`;
  }
  if (diffHour < 24) {
    return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;
  }
  if (diffDay === 1) {
    return "Yesterday";
  }
  if (diffDay < 7) {
    return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function getVisibleFilters(allowedRoles: AuthRole[] | undefined): ActivityFilter[] {
  const roles = allowedRoles ?? [];
  const isAdmin = roles.includes("admin");
  const isSeller = roles.includes("seller");

  if (isAdmin || isSeller) {
    return ["all", "buyer", "seller"];
  }
  return ["all", "buyer"];
}
