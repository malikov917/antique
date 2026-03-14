import type { AuthUser } from "@antique/types";
import { describe, expect, it } from "vitest";
import {
  canAccessRoleGovernance,
  canAccessSellerMutationControls,
  isAllowlistedAdmin
} from "./profileGovernance";

function buildUser(allowedRoles: AuthUser["allowedRoles"]): AuthUser {
  return {
    id: "user-1",
    phone: "+15550001111",
    displayName: "Tester",
    tenantId: "tenant-1",
    allowedRoles,
    activeRole: allowedRoles[0] ?? "buyer",
    sellerProfileId: null
  };
}

describe("profileGovernance", () => {
  it("treats admin-allowlisted user as admin", () => {
    const user = buildUser(["buyer", "admin"]);
    expect(isAllowlistedAdmin(user)).toBe(true);
    expect(canAccessRoleGovernance(user)).toBe(true);
    expect(canAccessSellerMutationControls(user)).toBe(true);
  });

  it("blocks non-admin users from role and seller mutation controls", () => {
    const user = buildUser(["buyer", "seller"]);
    expect(isAllowlistedAdmin(user)).toBe(false);
    expect(canAccessRoleGovernance(user)).toBe(false);
    expect(canAccessSellerMutationControls(user)).toBe(false);
  });

  it("blocks missing user context", () => {
    expect(isAllowlistedAdmin(undefined)).toBe(false);
    expect(canAccessRoleGovernance(null)).toBe(false);
    expect(canAccessSellerMutationControls(undefined)).toBe(false);
  });
});
