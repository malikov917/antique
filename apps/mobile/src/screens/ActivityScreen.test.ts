import { describe, expect, it } from "vitest";
import { formatRelativeTime, getVisibleFilters } from "./activityHelpers";

describe("formatRelativeTime", () => {
  const now = new Date("2026-05-07T12:00:00.000Z");

  it('returns "Just now" for < 60 seconds', () => {
    const date = new Date(now.getTime() - 30_000).toISOString();
    expect(formatRelativeTime(date, now)).toBe("Just now");
  });

  it('returns "X min ago" for < 60 minutes', () => {
    const twoMin = new Date(now.getTime() - 2 * 60_000).toISOString();
    const fiveMin = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(twoMin, now)).toBe("2 min ago");
    expect(formatRelativeTime(fiveMin, now)).toBe("5 min ago");
  });

  it('returns "X hour(s) ago" for < 24 hours', () => {
    const oneHour = new Date(now.getTime() - 60 * 60_000).toISOString();
    const threeHours = new Date(now.getTime() - 3 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(oneHour, now)).toBe("1 hour ago");
    expect(formatRelativeTime(threeHours, now)).toBe("3 hours ago");
  });

  it('returns "Yesterday" for 1 day ago', () => {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(yesterday, now)).toBe("Yesterday");
  });

  it('returns "X days ago" for 2-6 days ago', () => {
    const twoDays = new Date(now.getTime() - 2 * 24 * 60 * 60_000).toISOString();
    const sixDays = new Date(now.getTime() - 6 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(twoDays, now)).toBe("2 days ago");
    expect(formatRelativeTime(sixDays, now)).toBe("6 days ago");
  });

  it("returns short absolute date for >= 7 days", () => {
    const sevenDays = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(sevenDays, now)).toBe("Apr 30");
  });
});

describe("getVisibleFilters", () => {
  it("returns all and buyer for buyer-only roles", () => {
    expect(getVisibleFilters(["buyer"])).toEqual(["all", "buyer"]);
  });

  it("returns all filters for seller-capable roles", () => {
    expect(getVisibleFilters(["buyer", "seller"])).toEqual(["all", "buyer", "seller"]);
  });

  it("returns all filters for admin roles", () => {
    expect(getVisibleFilters(["admin"])).toEqual(["all", "buyer", "seller"]);
    expect(getVisibleFilters(["buyer", "admin"])).toEqual(["all", "buyer", "seller"]);
  });

  it("returns all and buyer for undefined roles", () => {
    expect(getVisibleFilters(undefined)).toEqual(["all", "buyer"]);
  });
});
