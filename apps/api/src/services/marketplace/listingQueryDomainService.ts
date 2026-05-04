import type { Database } from "better-sqlite3";
import type { VideoFeedItem } from "@antique/types";
import type { ListingQueryDomainService } from "../../domain/marketplace/contracts.js";

interface FeedListingRow {
  id: string;
  seller_user_id: string;
  playback_id: string;
  title: string;
  description: string;
  listed_price_cents: number;
  currency: string;
  created_at: number;
  listing_status: string;
  session_status: string;
  author: string | null;
}

export class SqliteListingQueryDomainService implements ListingQueryDomainService {
  constructor(private readonly sqlite: Database) {}

  listFeedItems(): VideoFeedItem[] {
    const rows = this.sqlite
      .prepare(
        `
          SELECT
            listings.id,
            listings.seller_user_id,
            listings.playback_id,
            listings.title,
            listings.description,
            listings.listed_price_cents,
            listings.currency,
            listings.created_at,
            listings.status AS listing_status,
            market_sessions.status AS session_status,
            users.display_name AS author
          FROM listings
          INNER JOIN market_sessions ON market_sessions.id = listings.market_session_id
          INNER JOIN users ON users.id = listings.seller_user_id
          WHERE listings.status = 'live'
            AND listings.playback_id IS NOT NULL
            AND market_sessions.status = 'open'
          ORDER BY listings.created_at DESC
        `
      )
      .all() as FeedListingRow[];

    return rows.map((row) => ({
      id: row.id,
      playbackId: row.playback_id,
      caption: row.description || row.title || "Antique listing",
      author: row.author || "seller",
      posterUrl: `https://image.mux.com/${row.playback_id}/thumbnail.jpg?time=1`,
      durationSec: 15,
      status: "ready" as const,
      freshnessUpdatedAt: new Date(row.created_at).toISOString(),
      freshnessAgeSec: Math.floor((Date.now() - row.created_at) / 1000),
      listingId: row.id,
      title: row.title,
      listedPriceCents: row.listed_price_cents,
      currency: row.currency,
      sellerUserId: row.seller_user_id,
      listingStatus: row.listing_status as "live" | "day_closed" | "sold" | "withdrawn",
      sessionStatus: row.session_status as "open" | "closed"
    }));
  }
}
