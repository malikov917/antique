import type { Database } from "better-sqlite3";
import type { Chat, ChatMessage } from "@antique/types";
import { newId } from "../auth/crypto.js";
import { AuthError } from "../auth/errors.js";
import { requireTenantScope } from "../auth/guards.js";
import type { ChatDomainService } from "../domain/marketplace/contracts.js";

interface ChatRow {
  id: string;
  deal_id: string;
  listing_id: string;
  seller_user_id: string;
  buyer_user_id: string;
  tenant_id: string | null;
  created_at: number;
  updated_at: number;
}

interface ChatMessageRow {
  id: string;
  chat_id: string;
  sender_user_id: string;
  body: string;
  created_at: number;
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    dealId: row.deal_id,
    listingId: row.listing_id,
    sellerUserId: row.seller_user_id,
    buyerUserId: row.buyer_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    senderUserId: row.sender_user_id,
    text: row.body,
    createdAt: toIso(row.created_at)
  };
}

export class SqliteChatDomainService implements ChatDomainService {
  constructor(
    private readonly sqlite: Database,
    private readonly now: () => number = () => Date.now()
  ) {}

  listChatsForUser(params: { userId: string }): Chat[] {
    const tenantId = this.resolveUserTenantId(params.userId);
    const rows = this.sqlite
      .prepare(
        `
          SELECT
            id,
            deal_id,
            listing_id,
            seller_user_id,
            buyer_user_id,
            tenant_id,
            created_at,
            updated_at
          FROM chats
          WHERE (seller_user_id = ? OR buyer_user_id = ?)
            AND tenant_id = ?
          ORDER BY updated_at DESC, id DESC
        `
      )
      .all(params.userId, params.userId, tenantId) as ChatRow[];

    return rows.map((row) => toChat(row));
  }

  listChatMessages(params: { userId: string; chatId: string }): ChatMessage[] {
    this.assertUserCanAccessChat(params.chatId, params.userId);
    const rows = this.sqlite
      .prepare(
        `
          SELECT id, chat_id, sender_user_id, body, created_at
          FROM chat_messages
          WHERE chat_id = ?
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(params.chatId) as ChatMessageRow[];

    return rows.map((row) => toChatMessage(row));
  }

  createChatMessage(params: { userId: string; chatId: string; text: string }): ChatMessage {
    this.assertUserCanAccessChat(params.chatId, params.userId);
    const id = newId();
    const timestamp = this.now();
    this.sqlite
      .prepare(
        `
          INSERT INTO chat_messages (id, chat_id, sender_user_id, tenant_id, body, created_at)
          VALUES (
            ?,
            ?,
            ?,
            (SELECT tenant_id FROM chats WHERE id = ?),
            ?,
            ?
          )
        `
      )
      .run(id, params.chatId, params.userId, params.chatId, params.text, timestamp);
    this.sqlite
      .prepare("UPDATE chats SET updated_at = ? WHERE id = ?")
      .run(timestamp, params.chatId);

    const row = this.sqlite
      .prepare(
        `
          SELECT id, chat_id, sender_user_id, body, created_at
          FROM chat_messages
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(id) as ChatMessageRow;
    return toChatMessage(row);
  }

  private getChatById(chatId: string): ChatRow | undefined {
    return this.sqlite
      .prepare(
        `
          SELECT
            id,
            deal_id,
            listing_id,
            seller_user_id,
            buyer_user_id,
            tenant_id,
            created_at,
            updated_at
          FROM chats
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(chatId) as ChatRow | undefined;
  }

  private assertUserCanAccessChat(chatId: string, userId: string): ChatRow {
    const chat = this.getChatById(chatId);
    if (!chat) {
      throw new AuthError("chat_not_found", "Chat was not found", 404);
    }
    if (chat.seller_user_id !== userId && chat.buyer_user_id !== userId) {
      throw new AuthError("forbidden_owner_mismatch", "Chat does not belong to user", 403);
    }
    const actorTenantId = this.resolveUserTenantId(userId);
    if (!chat.tenant_id) {
      throw new AuthError("forbidden_tenant_scope", "Chat tenant could not be resolved", 403);
    }
    requireTenantScope(chat.tenant_id, actorTenantId);
    return chat;
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
