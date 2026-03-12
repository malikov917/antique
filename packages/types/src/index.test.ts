import { describe, expect, it } from "vitest";
import {
  DEAL_STATUS_TRANSITIONS,
  MIN_OFFER_RULE,
  isDealStatusTransitionAllowed,
  type AuthPlatform,
  type UploadStatus
} from "./index.js";

describe("types", () => {
  it("contains ready upload status", () => {
    const status: UploadStatus = "ready";
    expect(status).toBe("ready");
  });

  it("contains supported auth platforms", () => {
    const platform: AuthPlatform = "ios";
    expect(platform).toBe("ios");
  });

  it("applies minimum offer rule", () => {
    expect(MIN_OFFER_RULE(1500, 1500)).toBe(true);
    expect(MIN_OFFER_RULE(1499, 1500)).toBe(false);
  });

  it("exports canonical deal status transition map", () => {
    expect(DEAL_STATUS_TRANSITIONS.open).toEqual(["payment_overdue", "paid", "cancellation_requested"]);
    expect(DEAL_STATUS_TRANSITIONS.payment_overdue).toEqual(["paid", "cancellation_requested"]);
    expect(DEAL_STATUS_TRANSITIONS.cancellation_requested).toEqual(["paid", "canceled", "refunded"]);
    expect(DEAL_STATUS_TRANSITIONS.completed).toEqual([]);
  });

  it("validates deal status transitions", () => {
    expect(isDealStatusTransitionAllowed("open", "payment_overdue")).toBe(true);
    expect(isDealStatusTransitionAllowed("payment_overdue", "paid")).toBe(true);
    expect(isDealStatusTransitionAllowed("open", "paid")).toBe(true);
    expect(isDealStatusTransitionAllowed("open", "cancellation_requested")).toBe(true);
    expect(isDealStatusTransitionAllowed("paid", "completed")).toBe(true);
    expect(isDealStatusTransitionAllowed("paid", "refunded")).toBe(true);
    expect(isDealStatusTransitionAllowed("completed", "paid")).toBe(false);
  });
});
