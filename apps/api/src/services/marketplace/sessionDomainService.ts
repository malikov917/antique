import type { Database } from "better-sqlite3";
import type { MarketSession, MarketSessionStatus } from "@antique/types";
import { newId } from "../../auth/crypto.js";
import { AuthError } from "../../auth/errors.js";
import { requireTenantScope } from "../../auth/guards.js";
import type {
  CloseMarketSessionResult,
  MarketSessionDomainService
} from "../../domain/marketplace/contracts.js";

interface MarketSessionRow {
  id: string;
  seller_user_id: string;
  tenant_id: string | null;
  status: MarketSessionStatus;
  opened_at: number;
  closed_at: number | null;
  created_at: number;
  updated_at: number;
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function toMarketSession(row: MarketSessionRow): MarketSession {
  return {
    id: row.id,
    sellerUserId: row.seller_user_id,
    status: row.status,
    openedAt: toIso(row.opened_at),
    closedAt: row.closed_at === null ? null : toIso(row.closed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export class SqliteMarketSessionDomainService implements MarketSessionDomainService {
  constructor(
    private readonly sqlite: Database,
    private readonly now: () => number = () => Date.now()
  ) {}

  openMarketSession(sellerUserId: string): MarketSession {
    this.assertSellerNotSuspended(sellerUserId);
    const existing = this.sqlite
      .prepare(
        `
          SELECT id
          FROM market_sessions
          WHERE seller_user_id = ?
            AND status = 'open'
          LIMIT 1
        `
      )
      .get(sellerUserId) as { id: string } | undefined;

    if (existing) {
      throw new AuthError("market_session_already_open", "Seller already has an open market session", 409);
    }

    const timestamp = this.now();
    const id = newId();
    const sellerTenantId = this.resolveUserTenantId(sellerUserId);
    this.sqlite
      .prepare(
        `
          INSERT INTO market_sessions (
            id,
            seller_user_id,
            tenant_id,
            status,
            opened_at,
            closed_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, 'open', ?, NULL, ?, ?)
        `
      )
      .run(id, sellerUserId, sellerTenantId, timestamp, timestamp, timestamp);

    const row = this.sqlite
      .prepare("SELECT * FROM market_sessions WHERE id = ? LIMIT 1")
      .get(id) as MarketSessionRow;

    return toMarketSession(row);
  }

  closeMarketSession(params: { sellerUserId: string; sessionId: string }): CloseMarketSessionResult {
    this.assertSellerNotSuspended(params.sellerUserId);
    const sellerTenantId = this.resolveUserTenantId(params.sellerUserId);
    const session = this.sqlite
      .prepare("SELECT * FROM market_sessions WHERE id = ? LIMIT 1")
      .get(params.sessionId) as MarketSessionRow | undefined;

    if (!session) {
      throw new AuthError("market_session_not_found", "Market session was not found", 404);
    }
    if (session.seller_user_id !== params.sellerUserId) {
      throw new AuthError("forbidden_owner_mismatch", "Market session does not belong to user", 403);
    }
    if (!session.tenant_id) {
      throw new AuthError("forbidden_tenant_scope", "Market session tenant could not be resolved", 403);
    }
    requireTenantScope(session.tenant_id, sellerTenantId);
    if (session.status !== "open") {
      throw new AuthError("market_session_not_open", "Market session is already closed", 409);
    }

    const timestamp = this.now();
    const tx = this.sqlite.transaction(
      (sessionId: string, nowTs: number): { transitionedListingCount: number } => {
        const listingResult = this.sqlite
          .prepare(
            `
              UPDATE listings
              SET status = 'day_closed',
                  updated_at = ?
              WHERE market_session_id = ?
                AND status = 'live'
            `
          )
          .run(nowTs, sessionId);

        this.sqlite
          .prepare(
            `
              UPDATE market_sessions
              SET status = 'closed',
                  closed_at = ?,
                  updated_at = ?
              WHERE id = ?
            `
          )
          .run(nowTs, nowTs, sessionId);

        return {
          transitionedListingCount: listingResult.changes
        };
      }
    );

    const result = tx(params.sessionId, timestamp);
    const updatedSession = this.sqlite
      .prepare("SELECT * FROM market_sessions WHERE id = ? LIMIT 1")
      .get(params.sessionId) as MarketSessionRow;

    return {
      session: toMarketSession(updatedSession),
      transitionedListingCount: result.transitionedListingCount
    };
  }

  private assertSellerNotSuspended(sellerUserId: string): void {
    const row = this.sqlite
      .prepare(
        `
          SELECT suspended_at
          FROM users
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(sellerUserId) as { suspended_at: number | null } | undefined;

    if (!row) {
      throw new AuthError("not_found", "User was not found", 404);
    }
    if (typeof row.suspended_at === "number") {
      throw new AuthError("seller_suspended", "Suspended sellers cannot perform seller actions", 403);
    }
  }

  private resolveUserTenantId(userId: string): string {
    const row = this.sqlite
      .prepare("SELECT tenant_id FROM users WHERE id = ? LIMIT 1")
      .get(userId) as { tenant_id: string } | undefined;

    if (!row?.tenant_id) {
      throw new AuthError("forbidden_tenant_scope", "User tenant could not be resolved", 403);
    }
    return row.tenant_id;
  }
}
