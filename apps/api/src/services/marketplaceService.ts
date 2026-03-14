import type { Database } from "better-sqlite3";
import { newId } from "../auth/crypto.js";

export interface MarketplaceRuntimeConfig {
  offerSubmitPerUserPerHour: number;
  offerDecisionPerSellerPerHour: number;
  dealPaymentDueAfterMs: number;
}

const DEFAULT_RUNTIME_CONFIG: MarketplaceRuntimeConfig = {
  offerSubmitPerUserPerHour: 30,
  offerDecisionPerSellerPerHour: 120,
  dealPaymentDueAfterMs: 48 * 60 * 60 * 1000
};

export interface PaymentOverdueSweepResult {
  transitionedDealCount: number;
  oldestDueOpenDealAgeMs: number | null;
  overdueOpenDealCount: number;
}

export class MarketplaceService {
  constructor(
    private readonly sqlite: Database,
    _runtimeConfig: MarketplaceRuntimeConfig = DEFAULT_RUNTIME_CONFIG,
    private readonly now: () => number = () => Date.now()
  ) {}

  runPaymentOverdueSweep(): PaymentOverdueSweepResult {
    const nowTs = this.now();
    const tx = this.sqlite.transaction(
      (timestamp: number): { transitionedDealIds: string[] } => {
        const dueRows = this.sqlite
          .prepare(
            `
              SELECT id
              FROM deals
              WHERE status = 'open'
                AND payment_due_at <= ?
              ORDER BY payment_due_at ASC
            `
          )
          .all(timestamp) as Array<{ id: string }>;

        if (dueRows.length === 0) {
          return { transitionedDealIds: [] };
        }

        this.sqlite
          .prepare(
            `
              UPDATE deals
              SET status = 'payment_overdue',
                  payment_overdue_at = ?,
                  payment_timeout_reason = 'payment_deadline_elapsed',
                  updated_at = ?
              WHERE status = 'open'
                AND payment_due_at <= ?
            `
          )
          .run(timestamp, timestamp, timestamp);

        return {
          transitionedDealIds: dueRows.map((row) => row.id)
        };
      }
    );

    const result = tx(nowTs);
    for (const dealId of result.transitionedDealIds) {
      this.recordDealPaymentTimeoutAudit({
        dealId,
        timeoutAtMs: nowTs
      });
    }

    return {
      transitionedDealCount: result.transitionedDealIds.length,
      ...this.getPaymentOverdueMetrics()
    };
  }

  getPaymentOverdueMetrics(): {
    oldestDueOpenDealAgeMs: number | null;
    overdueOpenDealCount: number;
  } {
    const nowTs = this.now();
    const overdueCountRow = this.sqlite
      .prepare(
        `
          SELECT COUNT(1) AS count
          FROM deals
          WHERE status = 'open'
            AND payment_due_at <= ?
        `
      )
      .get(nowTs) as { count: number } | undefined;
    const oldestDueRow = this.sqlite
      .prepare(
        `
          SELECT MIN(payment_due_at) AS oldest_due_at
          FROM deals
          WHERE status = 'open'
            AND payment_due_at <= ?
        `
      )
      .get(nowTs) as { oldest_due_at: number | null } | undefined;

    return {
      overdueOpenDealCount: overdueCountRow?.count ?? 0,
      oldestDueOpenDealAgeMs:
        oldestDueRow?.oldest_due_at === null || oldestDueRow?.oldest_due_at === undefined
          ? null
          : Math.max(0, nowTs - oldestDueRow.oldest_due_at)
    };
  }

  private recordDealPaymentTimeoutAudit(params: { dealId: string; timeoutAtMs: number }): void {
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
          ) VALUES (
            ?,
            'deal_payment_timeout',
            NULL,
            'system',
            (SELECT seller_user_id FROM deals WHERE id = ?),
            'allowed',
            'payment_deadline_elapsed',
            NULL,
            ?,
            ?
          )
        `
      )
      .run(
        newId(),
        params.dealId,
        JSON.stringify({ dealId: params.dealId }),
        params.timeoutAtMs
      );
  }
}
