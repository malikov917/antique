import type { AuthUser } from "@antique/types";

export function isAllowlistedAdmin(user: AuthUser | null | undefined): boolean {
  return Boolean(user?.allowedRoles.includes("admin"));
}

export function canAccessRoleGovernance(user: AuthUser | null | undefined): boolean {
  return isAllowlistedAdmin(user);
}

export function canAccessSellerMutationControls(user: AuthUser | null | undefined): boolean {
  return isAllowlistedAdmin(user);
}
