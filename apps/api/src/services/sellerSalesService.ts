import type { AuthRole } from "@antique/types";
import type { Database } from "better-sqlite3";
import { AuthError } from "../auth/errors.js";
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
    const requestedSellerUserId = input.requestedSellerUserId?.trim() || null;

    if (input.actor.activeRole === "buyer") {
      this.recordAuditEvent({
        actorUserId: input.actor.id,
        actorRole: input.actor.activeRole,
        targetSellerUserId: requestedSellerUserId,
        outcome: "denied",
        reasonCode: "forbidden_export_role",
        requestIp: input.requestIp ?? null,
        metadata: {}
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
          metadata: {}
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
          metadata: {}
        });
        throw new AuthError(
          "forbidden_export_scope",
          "Sellers can export only their own sales ledger",
          403
        );
      }
    }

    const targetSellerUserId = requestedSellerUserId ?? input.actor.id;
    const rows = this.fetchSellerSalesRows(targetSellerUserId);

    this.recordAuditEvent({
      actorUserId: input.actor.id,
      actorRole: input.actor.activeRole,
      targetSellerUserId,
      outcome: "allowed",
      reasonCode: "export_allowed",
      requestIp: input.requestIp ?? null,
      metadata: {
        rowCount: rows.length
      }
    });

    return {
      csv: this.toCsv(rows),
      fileName: `seller-sales-${targetSellerUserId}.csv`
    };
  }

  private isSellerSuspended(userId: string): boolean {
    const row = this.sqlite
      .prepare("SELECT suspended_at FROM users WHERE id = ? LIMIT 1")
      .get(userId) as { suspended_at: number | null } | undefined;

    return typeof row?.suspended_at === "number";
  }

  private fetchSellerSalesRows(sellerUserId: string): SellerSalesRow[] {
    return this.sqlite
      .prepare(
        `
          SELECT
            seller_user_id,
            session_id,
            listing_id,
            listing_title,
            accepted_offer_amount_cents,
            currency,
            buyer_user_id,
            sold_at
          FROM seller_sales
          WHERE seller_user_id = ?
          ORDER BY sold_at DESC, listing_id ASC
        `
      )
      .all(sellerUserId) as SellerSalesRow[];
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
      "soldAt"
    ];

    const lines = rows.map((row) => [
      row.seller_user_id,
      row.session_id,
      row.listing_id,
      row.listing_title,
      String(row.accepted_offer_amount_cents),
      row.currency,
      row.buyer_user_id,
      new Date(row.sold_at).toISOString()
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
