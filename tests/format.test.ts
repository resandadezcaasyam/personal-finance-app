import { describe, it, expect } from "vitest";
import { formatIDR, parseIDR, todayWIB, formatCompactIDR, formatMonthID } from "@/lib/format";

describe("formatIDR", () => {
  it("formats whole rupiah with Indonesian separators", () => {
    expect(formatIDR(1250000)).toBe("Rp 1.250.000");
    expect(formatIDR(0)).toBe("Rp 0");
  });
  it("formats negatives", () => {
    expect(formatIDR(-30000)).toContain("30.000");
  });
  it("rejects floats", () => {
    expect(() => formatIDR(10.5)).toThrow();
  });
});

describe("parseIDR", () => {
  it.each([
    ["25rb", 25000],
    ["25k", 25000],
    ["9,5jt", 9500000],
    ["1.250.000", 1250000],
    ["Rp 30.000", 30000],
    ["2jt", 2000000],
    ["150000", 150000],
  ])("parses %s", (input, expected) => {
    expect(parseIDR(input)).toBe(expected);
  });
  it.each(["", "abc", "1,5", "25 rb rb"])("returns null for %j", (input) => {
    expect(parseIDR(input)).toBeNull();
  });
});

describe("dates", () => {
  it("uses WIB, not UTC, for the calendar date", () => {
    // 2026-01-31 18:00 UTC is already Feb 1 in Jakarta (UTC+7)
    expect(todayWIB(new Date("2026-01-31T18:00:00Z"))).toBe("2026-02-01");
    expect(todayWIB(new Date("2026-01-31T16:59:00Z"))).toBe("2026-01-31");
  });
  it("formats months in Indonesian", () => {
    expect(formatMonthID("2026-11")).toBe("November 2026");
  });
  it("compacts large amounts", () => {
    expect(formatCompactIDR(9500000)).toBe("Rp 9,5 jt");
  });
});

describe("formatDateTimeID", () => {
  it("shows stored UTC timestamps in WIB", async () => {
    const { formatDateTimeID } = await import("@/lib/format");
    expect(formatDateTimeID("2026-11-20T07:05:00.000Z")).toBe("20 November 2026 14.05");
    expect(formatDateTimeID("2026-11-20T18:30:00.000Z")).toBe("21 November 2026 01.30");
  });
});
