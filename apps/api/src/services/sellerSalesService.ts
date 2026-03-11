import type { AuthRole, SellerSaleFulfillmentStatus, SellerSaleLedgerEntry } from "@antique/types";
import type { Database } from "better-sqlite3";
import { AuthError } from "../auth/errors.js";
import { requireTenantScope } from "../auth/guards.js";
import { newId } from "../auth/crypto.js";
import type {
  ExportSalesCsvInput,
  ExportSalesCsvResult,
  SellerSalesDomainService
} from "../domain/seller/contracts.js";

interface SellerSalesRow {
  seller_user_id: string;
  session_id: string;
  listing_id: string;
  listing_title: string;
  accepted_offer_amount_cents: number;
  currency: string;
  buyer_user_id: string;
  sold_at: number;
  fulfillment_status: SellerSaleFulfillmentStatus;
}

interface SalesQueryFilters {
  sessionId: string | null;
  day: string | null;
  soldAtMin: number | null;
  soldAtMaxExclusive: number | null;
}

interface ExportAuditEvent {
  actorUserId: string;
  actorRole: AuthRole;
  targetSellerUserId: string | null;
  outcome: "allowed" | "denied";
  reasonCode: string;
  requestIp: string | null;
  metadata: Record<string, unknown>;
}

export class SellerSalesService implements SellerSalesDomainService {
  constructor(
    private readonly sqlite: Database,
    private readonly now: () => number = () => Date.now()
  ) {}

  exportSalesCsv(input: ExportSalesCsvInput): ExportSalesCsvResult {
    const { targetSellerUserId, filters } = this.authorizeAndResolve(input);
    const rows = this.fetchSellerSalesRows(targetSellerUserId, input.actor.tenantId, filters);

    this.recordAuditEvent({
      actorUserId: input.actor.id,
      actorRole: input.actor.activeRole,
      targetSellerUserId,
      outcome: "allowed",
      reasonCode: "export_allowed",
      requestIp: input.requestIp ?? null,
      metadata: {
        rowCount: rows.length,
        sessionId: filters.sessionId,
        day: filters.day
      }
    });

    return {
      csv: this.toCsv(rows),
      fileName: `seller-sales-${targetSellerUserId}.csv`
    };
  }

  listSalesLedger(input: ExportSalesCsvInput): SellerSaleLedgerEntry[] {
    const { targetSellerUserId, filters } = this.authorizeAndResolve(input);
    const rows = this.fetchSellerSalesRows(targetSellerUserId, input.actor.tenantId, filters);

    return rows.map((row) => ({
      sellerUserId: row.seller_user_id,
      sessionId: row.session_id,
      listingId: row.listing_id,
      listingTitle: row.listing_title,
      acceptedOfferAmountCents: row.accepted_offer_amount_cents,
      currency: row.currency,
      buyerUserId: row.buyer_user_id,
      soldAt: new Date(row.sold_at).toISOString(),
      fulfillmentStatus: row.fulfillment_status
    }));
  }

  private authorizeAndResolve(input: ExportSalesCsvInput): {
    targetSellerUserId: string;
    filters: SalesQueryFilters;
  } {
    const requestedSellerUserId = input.requestedSellerUserId?.trim() || null;
    const filters = this.resolveFilters(input);

    if (input.actor.activeRole === "buyer") {
      this.recordAuditEvent({
        actorUserId: input.actor.id,
        actorRole: input.actor.activeRole,
        targetSellerUserId: requestedSellerUserId,
        outcome: "denied",
        reasonCode: "forbidden_export_role",
        requestIp: input.requestIp ?? null,
        metadata: {
          sessionId: filters.sessionId,
          day: filters.day
        }
      });
      throw new AuthError("forbidden_export_role", "Seller or admin role is required", 403);
    }

    if (input.actor.activeRole === "seller") {
      if (this.isSellerSuspended(input.actor.id)) {
        this.recordAuditEvent({
          actorUserId: input.actor.id,
          actorRole: input.actor.activeRole,
          targetSellerUserId: requestedSellerUserId ?? input.actor.id,
          outcome: "denied",
          reasonCode: "forbidden_seller_suspended",
          requestIp: input.requestIp ?? null,
          metadata: {
            sessionId: filters.sessionId,
            day: filters.day
          }
        });
        throw new AuthError(
          "forbidden_seller_suspended",
          "Suspended sellers cannot export sales CSV",
          403
        );
      }

      if (requestedSellerUserId && requestedSellerUserId !== input.actor.id) {
        this.recordAuditEvent({
          actorUserId: input.actor.id,
          actorRole: input.actor.activeRole,
          targetSellerUserId: requestedSellerUserId,
          outcome: "denied",
          reasonCode: "forbidden_export_scope",
          requestIp: input.requestIp ?? null,
          metadata: {
            sessionId: filters.sessionId,
            day: filters.day
          }
        });
        throw new AuthError(
          "forbidden_export_scope",
          "Sellers can export only their own sales ledger",
          403
        );
      }
    }

    const targetSellerUserId = requestedSellerUserId ?? input.actor.id;
    const targetSellerTenantId = this.resolveUserTenantId(targetSellerUserId);

    try {
      requireTenantScope(targetSellerTenantId, input.actor.tenantId);
    } catch (error) {
      if (error instanceof AuthError && error.code === "forbidden_tenant_scope") {
        this.recordAuditEvent({
          actorUserId: input.actor.id,
          actorRole: input.actor.activeRole,
          targetSellerUserId,
          outcome: "denied",
          reasonCode: "forbidden_tenant_scope",
          requestIp: input.requestIp ?? null,
          metadata: {
            sessionId: filters.sessionId,
            day: filters.day
          }
        });
      }
      throw error;
    }

    return {
      targetSellerUserId,
      filters
    };
  }

  private resolveFilters(input: ExportSalesCsvInput): SalesQueryFilters {
    const sessionId = input.sessionId?.trim() || null;
    const day = input.day?.trim() || null;

    if (!day) {
      return {
        sessionId,
        day: null,
        soldAtMin: null,
        soldAtMaxExclusive: null
      };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new AuthError("invalid_request", "day must be in YYYY-MM-DD format", 400);
    }

    const start = Date.parse(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(start)) {
      throw new AuthError("invalid_request", "day must be a valid date", 400);
    }

    return {
      sessionId,
      day,
      soldAtMin: start,
      soldAtMaxExclusive: start + 24 * 60 * 60 * 1000
    };
  }

  private isSellerSuspended(userId: string): boolean {
    const row = this.sqlite
      .prepare("SELECT suspended_at FROM users WHERE id = ? LIMIT 1")
      .get(userId) as { suspended_at: number | null } | undefined;

    return typeof row?.suspended_at === "number";
  }

  private fetchSellerSalesRows(
    sellerUserId: string,
    tenantId: string,
    filters: SalesQueryFilters
  ): SellerSalesRow[] {
    return this.sqlite
      .prepare(
        `
          SELECT
            seller_sales.seller_user_id,
            seller_sales.session_id,
            seller_sales.listing_id,
            seller_sales.listing_title,
            seller_sales.accepted_offer_amount_cents,
            seller_sales.currency,
            seller_sales.buyer_user_id,
            seller_sales.sold_at,
            COALESCE(deals.status, 'unknown') AS fulfillment_status
          FROM seller_sales
          LEFT JOIN deals ON deals.listing_id = seller_sales.listing_id
          WHERE seller_sales.seller_user_id = ?
            AND seller_sales.tenant_id = ?
            AND (? IS NULL OR seller_sales.session_id = ?)
            AND (? IS NULL OR seller_sales.sold_at >= ?)
            AND (? IS NULL OR seller_sales.sold_at < ?)
          ORDER BY seller_sales.sold_at DESC, seller_sales.listing_id ASC
        `
      )
      .all(
        sellerUserId,
        tenantId,
        filters.sessionId,
        filters.sessionId,
        filters.soldAtMin,
        filters.soldAtMin,
        filters.soldAtMaxExclusive,
        filters.soldAtMaxExclusive
      ) as SellerSalesRow[];
  }

  private resolveUserTenantId(userId: string): string {
    const row = this.sqlite
      .prepare("SELECT tenant_id FROM users WHERE id = ? LIMIT 1")
      .get(userId) as { tenant_id: string } | undefined;

    if (!row) {
      throw new AuthError("not_found", "User was not found", 404);
    }
    return row.tenant_id;
  }

  private toCsv(rows: SellerSalesRow[]): string {
    const header = [
      "sellerUserId",
      "sessionId",
      "listingId",
      "listingTitle",
      "acceptedOfferAmountCents",
      "currency",
      "buyerUserId",
      "soldAt",
      "fulfillmentStatus"
    ];

    const lines = rows.map((row) => [
      row.seller_user_id,
      row.session_id,
      row.listing_id,
      row.listing_title,
      String(row.accepted_offer_amount_cents),
      row.currency,
      row.buyer_user_id,
      new Date(row.sold_at).toISOString(),
      row.fulfillment_status
    ]);

    return [header, ...lines]
      .map((line) => line.map((value) => this.escapeCsv(value)).join(","))
      .join("\n");
  }

  private escapeCsv(value: string): string {
    if (!/[",\n]/.test(value)) {
      return value;
    }
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }

  private recordAuditEvent(event: ExportAuditEvent): void {
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
          ) VALUES (?, 'seller_sales_csv_export', ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        newId(),
        event.actorUserId,
        event.actorRole,
        event.targetSellerUserId,
        event.outcome,
        event.reasonCode,
        event.requestIp,
        JSON.stringify(event.metadata),
        this.now()
      );
  }
}
