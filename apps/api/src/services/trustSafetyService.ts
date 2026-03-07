import type { Database } from "better-sqlite3";
import {
  type FlagListingModerationResponse,
  type ReportUserResponse,
  type SuspendSellerResponse
} from "@antique/types";
import { AuthError } from "../auth/errors.js";
import { newId } from "../auth/crypto.js";
import { requireTenantScope } from "../auth/guards.js";

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function normalizeRequiredText(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AuthError("invalid_request", `${field} is required`, 400);
  }
  if (trimmed.length > maxLength) {
    throw new AuthError("invalid_request", `${field} must be at most ${maxLength} chars`, 400);
  }
  return trimmed;
}

function normalizeOptionalText(value: string | undefined, field: string, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new AuthError("invalid_request", `${field} must be at most ${maxLength} chars`, 400);
  }
  return trimmed;
}

function parseRoles(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

export class TrustSafetyService {
  constructor(
    private readonly sqlite: Database,
    private readonly now: () => number = () => Date.now()
  ) {}

  blockUser(params: { actorUserId: string; targetUserId: string }): { success: true } {
    if (params.actorUserId === params.targetUserId) {
      throw new AuthError("invalid_request", "Cannot block yourself", 400);
    }

    const actorTenantId = this.resolveTenantId(params.actorUserId);
    const targetTenantId = this.resolveTenantId(params.targetUserId);
    requireTenantScope(targetTenantId, actorTenantId);

    this.sqlite
      .prepare(
        `
          INSERT INTO user_blocks (
            id,
            blocker_user_id,
            blocked_user_id,
            tenant_id,
            created_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(blocker_user_id, blocked_user_id) DO NOTHING
        `
      )
      .run(newId(), params.actorUserId, params.targetUserId, actorTenantId, this.now());

    return { success: true };
  }

  reportUser(params: {
    actorUserId: string;
    targetUserId: string;
    reason: string;
    details?: string;
    requestIp?: string;
  }): ReportUserResponse {
    if (params.actorUserId === params.targetUserId) {
      throw new AuthError("invalid_request", "Cannot report yourself", 400);
    }

    const actorTenantId = this.resolveTenantId(params.actorUserId);
    const targetTenantId = this.resolveTenantId(params.targetUserId);
    requireTenantScope(targetTenantId, actorTenantId);

    const reason = normalizeRequiredText(params.reason, "reason", 120);
    const details = normalizeOptionalText(params.details, "details", 1000);
    const id = newId();
    const timestamp = this.now();

    this.sqlite
      .prepare(
        `
          INSERT INTO user_reports (
            id,
            reporter_user_id,
            reported_user_id,
            tenant_id,
            reason,
            details,
            request_ip,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        params.actorUserId,
        params.targetUserId,
        actorTenantId,
        reason,
        details,
        params.requestIp ?? null,
        timestamp
      );

    return {
      reportId: id,
      createdAt: toIso(timestamp)
    };
  }

  suspendSeller(params: {
    actorUserId: string;
    targetUserId: string;
    reason?: string;
    requestIp?: string;
  }): SuspendSellerResponse {
    const actorTenantId = this.resolveTenantId(params.actorUserId);
    const targetTenantId = this.resolveTenantId(params.targetUserId);
    requireTenantScope(targetTenantId, actorTenantId);

    const userRow = this.sqlite
      .prepare(
        `
          SELECT allowed_roles
          FROM users
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(params.targetUserId) as { allowed_roles: string } | undefined;

    if (!userRow) {
      throw new AuthError("not_found", "User was not found", 404);
    }

    const roles = parseRoles(userRow.allowed_roles);
    if (!roles.includes("seller")) {
      throw new AuthError("invalid_request", "Target user is not seller-enabled", 409);
    }

    const reason = normalizeOptionalText(params.reason, "reason", 500);
    const timestamp = this.now();
    this.sqlite
      .prepare(
        `
          UPDATE users
          SET suspended_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, params.targetUserId);

    this.sqlite
      .prepare(
        `
          INSERT INTO audit_events (
            id,
            event_type,
            actor_user_id,
            actor_role,
            target_seller_user_id,
            outcome,
            reason_code,
            request_ip,
            metadata_json,
            created_at
          ) VALUES (?, 'seller_suspension', ?, 'admin', ?, 'allowed', 'seller_suspended', ?, ?, ?)
        `
      )
      .run(
        newId(),
        params.actorUserId,
        params.targetUserId,
        params.requestIp ?? null,
        JSON.stringify({ reason }),
        timestamp
      );

    return {
      userId: params.targetUserId,
      suspendedAt: toIso(timestamp)
    };
  }

  flagListing(params: {
    actorUserId: string;
    listingId: string;
    reasonCode: string;
    note?: string;
    requestIp?: string;
  }): FlagListingModerationResponse {
    const listing = this.sqlite
      .prepare(
        `
          SELECT tenant_id
          FROM listings
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(params.listingId) as { tenant_id: string | null } | undefined;

    if (!listing) {
      throw new AuthError("listing_not_found", "Listing was not found", 404);
    }

    const actorTenantId = this.resolveTenantId(params.actorUserId);
    if (!listing.tenant_id) {
      throw new AuthError("forbidden_tenant_scope", "Listing tenant could not be resolved", 403);
    }
    requireTenantScope(listing.tenant_id, actorTenantId);

    const reasonCode = normalizeRequiredText(params.reasonCode, "reasonCode", 120);
    const note = normalizeOptionalText(params.note, "note", 1000);
    const id = newId();
    const timestamp = this.now();

    this.sqlite
      .prepare(
        `
          INSERT INTO listing_moderation_flags (
            id,
            listing_id,
            actor_user_id,
            tenant_id,
            reason_code,
            note,
            status,
            request_ip,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
        `
      )
      .run(
        id,
        params.listingId,
        params.actorUserId,
        actorTenantId,
        reasonCode,
        note,
        params.requestIp ?? null,
        timestamp
      );

    return {
      flagId: id,
      listingId: params.listingId,
      status: "open",
      reasonCode,
      createdAt: toIso(timestamp)
    };
  }

  private resolveTenantId(userId: string): string {
    const row = this.sqlite
      .prepare(
        `
          SELECT tenant_id
          FROM users
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(userId) as { tenant_id: string } | undefined;

    if (!row?.tenant_id) {
      throw new AuthError("not_found", "User was not found", 404);
    }

    return row.tenant_id;
  }
}
