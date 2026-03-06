import type { Database } from "better-sqlite3";
import { type AuthRole, type SellerApplication, type SellerApplicationStatus } from "@antique/types";
import { AuthError } from "../auth/errors.js";
import { requireTenantScope } from "../auth/guards.js";
import { newId } from "../auth/crypto.js";
import type {
  RejectSellerApplicationInput,
  ReviewSellerApplicationInput,
  SellerApplicationDomainService,
  SubmitSellerApplicationInput
} from "../domain/seller/contracts.js";

interface SellerApplicationRow {
  id: string;
  user_id: string;
  status: SellerApplicationStatus;
  full_name: string | null;
  shop_name: string | null;
  note: string | null;
  rejection_reason: string | null;
  submitted_at: number | null;
  reviewed_at: number | null;
  reviewed_by_user_id: string | null;
  created_at: number;
  updated_at: number;
}

interface UserRoleRow {
  allowed_roles: string;
  active_role: AuthRole;
  seller_profile_id: string | null;
}

interface UserTenantRow {
  id: string;
  tenant_id: string;
}

function toIso(timestampMs: number | null): string | null {
  return timestampMs === null ? null : new Date(timestampMs).toISOString();
}

function normalizeText(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AuthError("invalid_request", `${field} is required`, 400);
  }
  if (trimmed.length > maxLength) {
    throw new AuthError("invalid_request", `${field} must be at most ${maxLength} chars`, 400);
  }
  return trimmed;
}

function normalizeOptionalText(value: string | undefined, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new AuthError("invalid_request", `note must be at most ${maxLength} chars`, 400);
  }
  return trimmed;
}

function normalizeRejectionReason(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AuthError("invalid_request", "reason is required", 400);
  }
  if (trimmed.length > 500) {
    throw new AuthError("invalid_request", "reason must be at most 500 chars", 400);
  }
  return trimmed;
}

function parseAllowedRoles(raw: string): AuthRole[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return ["buyer"];
    }
    const roles = parsed.filter((entry): entry is AuthRole =>
      entry === "buyer" || entry === "seller" || entry === "admin"
    );
    return roles.length > 0 ? roles : ["buyer"];
  } catch {
    return ["buyer"];
  }
}

export class SellerApplicationService implements SellerApplicationDomainService {
  constructor(
    private readonly sqlite: Database,
    private readonly now: () => number = () => Date.now()
  ) {}

  getForUser(userId: string): SellerApplication {
    const row = this.sqlite
      .prepare(
        `
          SELECT *
          FROM seller_applications
          WHERE user_id = ?
          LIMIT 1
        `
      )
      .get(userId) as SellerApplicationRow | undefined;

    if (!row) {
      return {
        status: "not_requested",
        fullName: null,
        shopName: null,
        note: null,
        rejectionReason: null,
        submittedAt: null,
        reviewedAt: null,
        updatedAt: null
      };
    }

    return {
      status: row.status,
      fullName: row.full_name,
      shopName: row.shop_name,
      note: row.note,
      rejectionReason: row.rejection_reason,
      submittedAt: toIso(row.submitted_at),
      reviewedAt: toIso(row.reviewed_at),
      updatedAt: toIso(row.updated_at)
    };
  }

  submit(input: SubmitSellerApplicationInput): SellerApplication {
    const fullName = normalizeText(input.fullName, "fullName", 120);
    const shopName = normalizeText(input.shopName, "shopName", 120);
    const note = normalizeOptionalText(input.note, 1000);
    const now = this.now();

    this.sqlite
      .prepare(
        `
          INSERT INTO seller_applications (
            id,
            user_id,
            status,
            full_name,
            shop_name,
            note,
            rejection_reason,
            submitted_at,
            reviewed_at,
            reviewed_by_user_id,
            created_at,
            updated_at
          ) VALUES (?, ?, 'pending', ?, ?, ?, NULL, ?, NULL, NULL, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            status = 'pending',
            full_name = excluded.full_name,
            shop_name = excluded.shop_name,
            note = excluded.note,
            rejection_reason = NULL,
            submitted_at = excluded.submitted_at,
            reviewed_at = NULL,
            reviewed_by_user_id = NULL,
            updated_at = excluded.updated_at
        `
      )
      .run(newId(), input.userId, fullName, shopName, note, now, now, now);

    return this.getForUser(input.userId);
  }

  approve(input: ReviewSellerApplicationInput): SellerApplication {
    return this.review(input, "approved");
  }

  reject(input: RejectSellerApplicationInput): SellerApplication {
    return this.review(input, "rejected", normalizeRejectionReason(input.reason));
  }

  private review(
    input: ReviewSellerApplicationInput,
    nextStatus: "approved" | "rejected",
    rejectionReason: string | null = null
  ): SellerApplication {
    const targetUser = this.sqlite
      .prepare("SELECT id FROM users WHERE id = ? LIMIT 1")
      .get(input.targetUserId) as { id: string } | undefined;
    if (!targetUser) {
      throw new AuthError("not_found", "User was not found", 404);
    }

    const actorTenant = this.resolveUserTenant(input.actorUserId);
    const targetTenant = this.resolveUserTenant(input.targetUserId);
    requireTenantScope(targetTenant.tenant_id, actorTenant.tenant_id);

    const now = this.now();
    const run = this.sqlite.transaction(() => {
      const row = this.sqlite
        .prepare(
          `
            SELECT status
            FROM seller_applications
            WHERE user_id = ?
            LIMIT 1
          `
        )
        .get(input.targetUserId) as { status: SellerApplicationStatus } | undefined;

      if (!row || row.status === "not_requested") {
        throw new AuthError(
          "application_not_requested",
          "Seller application has not been submitted",
          409
        );
      }

      if (row.status === nextStatus) {
        this.recordReviewAudit({
          actorUserId: input.actorUserId,
          targetUserId: input.targetUserId,
          decision: nextStatus,
          outcome: "allowed",
          reasonCode: "idempotent_noop",
          requestIp: input.requestIp ?? null
        });
        return;
      }

      if (row.status !== "pending") {
        throw new AuthError(
          "invalid_application_transition",
          "Only pending seller applications can be reviewed",
          409
        );
      }

      this.sqlite
        .prepare(
          `
            UPDATE seller_applications
            SET status = ?,
                rejection_reason = ?,
                reviewed_at = ?,
                reviewed_by_user_id = ?,
                updated_at = ?
            WHERE user_id = ?
          `
        )
        .run(nextStatus, rejectionReason, now, input.actorUserId, now, input.targetUserId);

      if (nextStatus === "approved") {
        this.enableSellerRole(input.targetUserId);
      } else {
        this.disableSellerRole(input.targetUserId);
      }

      this.recordReviewAudit({
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        decision: nextStatus,
        outcome: "allowed",
        reasonCode: nextStatus === "approved" ? "application_approved" : "application_rejected",
        requestIp: input.requestIp ?? null
      });
    });

    try {
      run();
    } catch (error) {
      if (
        error instanceof AuthError &&
        (error.code === "application_not_requested" || error.code === "invalid_application_transition")
      ) {
        this.recordReviewAudit({
          actorUserId: input.actorUserId,
          targetUserId: input.targetUserId,
          decision: nextStatus,
          outcome: "denied",
          reasonCode: error.code,
          requestIp: input.requestIp ?? null
        });
      }
      throw error;
    }

    return this.getForUser(input.targetUserId);
  }

  private resolveUserTenant(userId: string): UserTenantRow {
    const row = this.sqlite
      .prepare(
        `
          SELECT id, tenant_id
          FROM users
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(userId) as UserTenantRow | undefined;

    if (!row) {
      throw new AuthError("not_found", "User was not found", 404);
    }
    return row;
  }

  private enableSellerRole(userId: string): void {
    const user = this.sqlite
      .prepare(
        `
          SELECT allowed_roles, active_role, seller_profile_id
          FROM users
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(userId) as UserRoleRow | undefined;

    if (!user) {
      throw new AuthError("not_found", "User was not found", 404);
    }

    const roles = parseAllowedRoles(user.allowed_roles);
    if (!roles.includes("seller")) {
      roles.push("seller");
    }

    this.sqlite
      .prepare(
        `
          UPDATE users
          SET allowed_roles = ?,
              seller_profile_id = ?
          WHERE id = ?
        `
      )
      .run(
        JSON.stringify(roles),
        user.seller_profile_id ?? `seller-profile-${newId()}`,
        userId
      );
  }

  private disableSellerRole(userId: string): void {
    const user = this.sqlite
      .prepare(
        `
          SELECT allowed_roles, active_role, seller_profile_id
          FROM users
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(userId) as UserRoleRow | undefined;

    if (!user) {
      throw new AuthError("not_found", "User was not found", 404);
    }

    const filteredRoles = parseAllowedRoles(user.allowed_roles).filter((role) => role !== "seller");
    const normalizedRoles = filteredRoles.length > 0 ? filteredRoles : ["buyer"];
    const nextActiveRole = user.active_role === "seller" ? "buyer" : user.active_role;

    this.sqlite
      .prepare(
        `
          UPDATE users
          SET allowed_roles = ?,
              active_role = ?,
              seller_profile_id = NULL
          WHERE id = ?
        `
      )
      .run(JSON.stringify(normalizedRoles), nextActiveRole, userId);
  }

  private recordReviewAudit(params: {
    actorUserId: string;
    targetUserId: string;
    decision: "approved" | "rejected";
    outcome: "allowed" | "denied";
    reasonCode: string;
    requestIp: string | null;
  }): void {
    this.sqlite
      .prepare(
        `
          INSERT INTO audit_events(
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
          ) VALUES (?, 'seller_application_review', ?, 'admin', ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        newId(),
        params.actorUserId,
        params.targetUserId,
        params.outcome,
        params.reasonCode,
        params.requestIp,
        JSON.stringify({ decision: params.decision }),
        this.now()
      );
  }
}
