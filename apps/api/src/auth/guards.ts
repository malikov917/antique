import type { AuthRole, AuthUser } from "@antique/types";
import { AuthError } from "./errors.js";

export function requireRoleAllowed(user: AuthUser, role: AuthRole): void {
  if (!user.allowedRoles.includes(role)) {
    throw new AuthError("forbidden_role_switch", "Requested role is not allowed for this user", 403);
  }
}

export function requireBuyerRole(user: AuthUser): void {
  if (user.activeRole !== "buyer") {
    throw new AuthError("forbidden_buyer_role", "Buyer role is required", 403);
  }
}

export function requireSellerRole(user: AuthUser): void {
  if (user.activeRole !== "seller") {
    throw new AuthError("forbidden_seller_role", "Seller role is required", 403);
  }
}

export function requireSharedOwnership(ownerUserId: string, user: AuthUser): void {
  if (ownerUserId !== user.id) {
    throw new AuthError("forbidden_owner_mismatch", "Resource does not belong to the authenticated user", 403);
  }
}
