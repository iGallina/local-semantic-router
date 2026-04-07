import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { logUsage, readUsageLogs, setLogDir } from "./usage-logger.js";
import type { UsageLogEntry } from "./usage-logger.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `lsr-log-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEntry(overrides?: Partial<UsageLogEntry>): UsageLogEntry {
  return {
    timestamp: new Date().toISOString(),
    model: "groq/llama-3.3-70b-versatile",
    tier: "SIMPLE",
    provider: "groq",
    streaming: false,
    inputTokens: 100,
    outputTokens: 50,
    actualCost: 0.0001,
    estimatedCost: 0.0002,
    latencyMs: 250,
    ...overrides,
  };
}

describe("usage-logger", () => {
  let logDir: string;

  beforeEach(() => {
    logDir = makeTempDir();
    setLogDir(logDir);
  });

  afterEach(() => {
    setLogDir(undefined);
  });

  it("creates JSONL file and appends entry", async () => {
    await logUsage(makeEntry());

    const files = readdirSync(logDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^usage-\d{4}-\d{2}-\d{2}\.jsonl$/);

    const content = readFileSync(join(logDir, files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as UsageLogEntry;
    expect(parsed.model).toBe("groq/llama-3.3-70b-versatile");
    expect(parsed.inputTokens).toBe(100);
  });

  it("appends multiple entries to same file", async () => {
    await logUsage(makeEntry({ inputTokens: 10 }));
    await logUsage(makeEntry({ inputTokens: 20 }));
    await logUsage(makeEntry({ inputTokens: 30 }));

    const files = readdirSync(logDir);
    const content = readFileSync(join(logDir, files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  it("creates log directory if it does not exist", async () => {
    const nested = join(logDir, "nested", "deep");
    setLogDir(nested);

    await logUsage(makeEntry());

    const files = readdirSync(nested);
    expect(files).toHaveLength(1);
  });

  it("readUsageLogs returns entries from today", async () => {
    await logUsage(makeEntry({ model: "a" }));
    await logUsage(makeEntry({ model: "b" }));

    const entries = await readUsageLogs(1);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.model)).toEqual(["a", "b"]);
  });

  it("readUsageLogs returns empty array when no logs exist", async () => {
    const empty = join(logDir, "empty");
    setLogDir(empty);

    const entries = await readUsageLogs(7);
    expect(entries).toHaveLength(0);
  });
});
