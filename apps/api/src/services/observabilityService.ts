import type { Database } from "better-sqlite3";
import { newId } from "../auth/crypto.js";

function toP95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

export interface ObservabilitySummary {
  windowHours: number;
  funnel: {
    view: number;
    basket: number;
    offer: number;
    accepted: number;
    paid: number;
  };
  errors: {
    total4xx: number;
    total5xx: number;
    topRoutes: Array<{
      route: string;
      requests: number;
      errors: number;
      p95LatencyMs: number;
    }>;
  };
  sellerDecisionAudit: {
    offerDecisions: number;
    csvExports: number;
    recent: Array<{
      eventType: string;
      actorUserId: string | null;
      targetSellerUserId: string | null;
      outcome: string;
      reasonCode: string;
      createdAt: string;
    }>;
  };
}

export class ObservabilityService {
  constructor(
    private readonly sqlite: Database,
    private readonly now: () => number = () => Date.now()
  ) {}

  recordRequestMetric(params: {
    method: string;
    routePattern: string;
    statusCode: number;
    durationMs: number;
  }): void {
    this.sqlite
      .prepare(
        `
          INSERT INTO request_metrics (
            id,
            method,
            route_pattern,
            status_code,
            duration_ms,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        newId(),
        params.method.toUpperCase(),
        params.routePattern,
        params.statusCode,
        Math.max(0, Math.round(params.durationMs)),
        this.now()
      );
  }

  getSummary(windowHours: number): ObservabilitySummary {
    const safeWindowHours = Number.isFinite(windowHours) ? Math.min(Math.max(windowHours, 1), 168) : 24;
    const since = this.now() - safeWindowHours * 60 * 60 * 1000;

    const view = this.sqlite
      .prepare(
        `
          SELECT COUNT(1) AS count
          FROM request_metrics
          WHERE method = 'GET'
            AND route_pattern = '/v1/feed'
            AND status_code BETWEEN 200 AND 399
            AND created_at >= ?
        `
      )
      .get(since) as { count: number } | undefined;

    const basket = this.countFunnel("basket_added", since);
    const offer = this.countFunnel("offer_submitted", since);
    const accepted = this.countFunnel("offer_accepted", since);
    const paid = this.countFunnel("deal_paid", since);

    const metricRows = this.sqlite
      .prepare(
        `
          SELECT route_pattern, status_code, duration_ms
          FROM request_metrics
          WHERE created_at >= ?
        `
      )
      .all(since) as Array<{ route_pattern: string; status_code: number; duration_ms: number }>;

    const total4xx = metricRows.filter((row) => row.status_code >= 400 && row.status_code < 500).length;
    const total5xx = metricRows.filter((row) => row.status_code >= 500).length;

    const routeMap = new Map<string, { requests: number; errors: number; durations: number[] }>();
    for (const row of metricRows) {
      const key = row.route_pattern || "unknown";
      const existing = routeMap.get(key) ?? { requests: 0, errors: 0, durations: [] };
      existing.requests += 1;
      if (row.status_code >= 400) {
        existing.errors += 1;
      }
      existing.durations.push(row.duration_ms);
      routeMap.set(key, existing);
    }

    const topRoutes = [...routeMap.entries()]
      .map(([route, value]) => ({
        route,
        requests: value.requests,
        errors: value.errors,
        p95LatencyMs: toP95(value.durations)
      }))
      .sort((a, b) => b.errors - a.errors || b.requests - a.requests)
      .slice(0, 5);

    const offerDecisions = this.sqlite
      .prepare(
        `
          SELECT COUNT(1) AS count
          FROM audit_events
          WHERE event_type = 'offer_action'
            AND reason_code = 'decision'
            AND created_at >= ?
        `
      )
      .get(since) as { count: number } | undefined;

    const csvExports = this.sqlite
      .prepare(
        `
          SELECT COUNT(1) AS count
          FROM audit_events
          WHERE event_type = 'seller_sales_csv_export'
            AND created_at >= ?
        `
      )
      .get(since) as { count: number } | undefined;

    const recentRows = this.sqlite
      .prepare(
        `
          SELECT event_type, actor_user_id, target_seller_user_id, outcome, reason_code, created_at
          FROM audit_events
          WHERE created_at >= ?
            AND (
              (event_type = 'offer_action' AND reason_code = 'decision')
              OR event_type = 'seller_sales_csv_export'
            )
          ORDER BY created_at DESC
          LIMIT 20
        `
      )
      .all(since) as Array<{
      event_type: string;
      actor_user_id: string | null;
      target_seller_user_id: string | null;
      outcome: string;
      reason_code: string;
      created_at: number;
    }>;

    return {
      windowHours: safeWindowHours,
      funnel: {
        view: view?.count ?? 0,
        basket: basket?.count ?? 0,
        offer: offer?.count ?? 0,
        accepted: accepted?.count ?? 0,
        paid: paid?.count ?? 0
      },
      errors: {
        total4xx,
        total5xx,
        topRoutes
      },
      sellerDecisionAudit: {
        offerDecisions: offerDecisions?.count ?? 0,
        csvExports: csvExports?.count ?? 0,
        recent: recentRows.map((row) => ({
          eventType: row.event_type,
          actorUserId: row.actor_user_id,
          targetSellerUserId: row.target_seller_user_id,
          outcome: row.outcome,
          reasonCode: row.reason_code,
          createdAt: new Date(row.created_at).toISOString()
        }))
      }
    };
  }

  private countFunnel(reasonCode: string, since: number): { count: number } | undefined {
    return this.sqlite
      .prepare(
        `
          SELECT COUNT(1) AS count
          FROM audit_events
          WHERE event_type = 'funnel_event'
            AND reason_code = ?
            AND created_at >= ?
        `
      )
      .get(reasonCode, since) as { count: number } | undefined;
  }
}
