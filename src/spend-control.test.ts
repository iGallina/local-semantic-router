import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SpendControl } from "./spend-control.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `lsr-spend-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("SpendControl", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = makeTempDir();
  });

  it("allows requests within all limits", () => {
    const sc = new SpendControl({ per_request: 1.0, hourly: 5.0, daily: 20.0 }, dataDir);
    const result = sc.check(0.5);
    expect(result.allowed).toBe(true);
  });

  it("blocks request exceeding per-request limit", () => {
    const sc = new SpendControl({ per_request: 0.10 }, dataDir);
    const result = sc.check(0.50);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe("perRequest");
  });

  it("blocks when hourly limit would be exceeded", () => {
    const sc = new SpendControl({ hourly: 1.0 }, dataDir);
    sc.record(0.80, "model-a");
    const result = sc.check(0.30);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe("hourly");
  });

  it("blocks when daily limit would be exceeded", () => {
    const sc = new SpendControl({ daily: 2.0 }, dataDir);
    sc.record(1.50, "model-a");
    sc.record(0.40, "model-b");
    const result = sc.check(0.20);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe("daily");
  });

  it("allows when no limits are configured", () => {
    const sc = new SpendControl({}, dataDir);
    sc.record(999.0, "model-a");
    const result = sc.check(999.0);
    expect(result.allowed).toBe(true);
  });

  it("persists spending history to file", () => {
    const sc = new SpendControl({ daily: 100 }, dataDir);
    sc.record(1.23, "model-a");

    const filePath = join(dataDir, "spending.json");
    expect(existsSync(filePath)).toBe(true);

    const data = JSON.parse(readFileSync(filePath, "utf-8")) as {
      history: Array<{ amount: number; model: string }>;
    };
    expect(data.history).toHaveLength(1);
    expect(data.history[0].amount).toBe(1.23);
    expect(data.history[0].model).toBe("model-a");
  });

  it("loads existing history on construction", () => {
    const filePath = join(dataDir, "spending.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        history: [{ ts: Date.now(), amount: 4.0, model: "model-a" }],
      }),
      "utf-8",
    );

    const sc = new SpendControl({ daily: 5.0 }, dataDir);
    const result = sc.check(2.0);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe("daily");
  });

  it("trims records older than 24 hours", () => {
    const oldTs = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    const filePath = join(dataDir, "spending.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        history: [
          { ts: oldTs, amount: 100.0, model: "old" },
          { ts: Date.now(), amount: 1.0, model: "recent" },
        ],
      }),
      "utf-8",
    );

    const sc = new SpendControl({ daily: 5.0 }, dataDir);
    // Old record trimmed, only $1 recent spend
    const result = sc.check(3.0);
    expect(result.allowed).toBe(true);
  });

  it("getStatus returns correct spending totals", () => {
    const sc = new SpendControl({ per_request: 1.0, hourly: 10.0, daily: 50.0 }, dataDir);
    sc.record(2.0, "model-a");
    sc.record(3.0, "model-b");

    const status = sc.getStatus();
    expect(status.hourlySpend).toBe(5.0);
    expect(status.dailySpend).toBe(5.0);
    expect(status.requestCount24h).toBe(2);
    expect(status.limits.perRequest).toBe(1.0);
    expect(status.limits.hourly).toBe(10.0);
    expect(status.limits.daily).toBe(50.0);
  });

  it("handles corrupt spending file gracefully", () => {
    writeFileSync(join(dataDir, "spending.json"), "NOT JSON", "utf-8");
    const sc = new SpendControl({ daily: 10.0 }, dataDir);
    const result = sc.check(1.0);
    expect(result.allowed).toBe(true);
  });
});
