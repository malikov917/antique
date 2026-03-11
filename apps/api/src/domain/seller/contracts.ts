import type { AuthUser, SellerApplication, SellerSaleLedgerEntry } from "@antique/types";

export interface SubmitSellerApplicationInput {
  userId: string;
  fullName: string;
  shopName: string;
  note?: string;
}

export interface ReviewSellerApplicationInput {
  actorUserId: string;
  targetUserId: string;
  requestIp?: string;
}

export interface RejectSellerApplicationInput extends ReviewSellerApplicationInput {
  reason: string;
}

export interface SellerApplicationDomainService {
  getForUser(userId: string): SellerApplication;
  submit(input: SubmitSellerApplicationInput): SellerApplication;
  approve(input: ReviewSellerApplicationInput): SellerApplication;
  reject(input: RejectSellerApplicationInput): SellerApplication;
}

export interface ExportSalesCsvInput {
  actor: AuthUser;
  requestedSellerUserId?: string;
  sessionId?: string;
  day?: string;
  requestIp?: string;
}

export interface ExportSalesCsvResult {
  csv: string;
  fileName: string;
}

export interface SellerSalesDomainService {
  exportSalesCsv(input: ExportSalesCsvInput): ExportSalesCsvResult;
  listSalesLedger(input: ExportSalesCsvInput): SellerSaleLedgerEntry[];
}
