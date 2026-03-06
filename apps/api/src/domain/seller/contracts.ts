import type { AuthUser, SellerApplication } from "@antique/types";

export interface SubmitSellerApplicationInput {
  userId: string;
  fullName: string;
  shopName: string;
  note?: string;
}

export interface SellerApplicationDomainService {
  getForUser(userId: string): SellerApplication;
  submit(input: SubmitSellerApplicationInput): SellerApplication;
}

export interface ExportSalesCsvInput {
  actor: AuthUser;
  requestedSellerUserId?: string;
  requestIp?: string;
}

export interface ExportSalesCsvResult {
  csv: string;
  fileName: string;
}

export interface SellerSalesDomainService {
  exportSalesCsv(input: ExportSalesCsvInput): ExportSalesCsvResult;
}
