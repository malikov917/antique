import type { Database } from "better-sqlite3";
import { type SellerApplication, type SellerApplicationStatus } from "@antique/types";
import { AuthError } from "../auth/errors.js";
import { newId } from "../auth/crypto.js";
import type {
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
  created_at: number;
  updated_at: number;
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
            created_at,
            updated_at
          ) VALUES (?, ?, 'pending', ?, ?, ?, NULL, ?, NULL, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            status = 'pending',
            full_name = excluded.full_name,
            shop_name = excluded.shop_name,
            note = excluded.note,
            rejection_reason = NULL,
            submitted_at = excluded.submitted_at,
            reviewed_at = NULL,
            updated_at = excluded.updated_at
        `
      )
      .run(newId(), input.userId, fullName, shopName, note, now, now, now);

    return this.getForUser(input.userId);
  }
}
