/**
 * Spend Control — rolling window spending limits.
 *
 * Tracks cumulative spending in-memory with async persistence to:
 *   ~/.local-semantic-router/spending.json
 *
 * Pre-request check is pure in-memory (no I/O on the hot path).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BudgetConfig } from "./config-types.js";

// ── Types ─────────────────────────────────────────────────────────

export interface SpendLimits {
  perRequest?: number;
  hourly?: number;
  daily?: number;
}

interface SpendRecord {
  ts: number; // epoch ms
  amount: number;
  model: string;
}

export interface CheckResult {
  allowed: boolean;
  blockedBy?: "perRequest" | "hourly" | "daily";
  reason?: string;
}

export interface SpendingStatus {
  limits: SpendLimits;
  hourlySpend: number;
  dailySpend: number;
  requestCount24h: number;
}

// ── Constants ─────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const SPENDING_FILE = "spending.json";

// ── Class ─────────────────────────────────────────────────────────

export class SpendControl {
  private limits: SpendLimits;
  private history: SpendRecord[] = [];
  private dataDir: string;
  private filePath: string;

  constructor(budget: BudgetConfig, dataDir: string) {
    this.limits = {
      perRequest: budget.per_request,
      hourly: budget.hourly,
      daily: budget.daily,
    };
    this.dataDir = dataDir;
    this.filePath = join(dataDir, SPENDING_FILE);
    this.load();
    this.trim();
  }

  /** Check if a request with the given estimated cost is allowed. */
  check(estimatedCost: number): CheckResult {
    if (this.limits.perRequest !== undefined && estimatedCost > this.limits.perRequest) {
      return {
        allowed: false,
        blockedBy: "perRequest",
        reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds per-request limit $${this.limits.perRequest.toFixed(2)}`,
      };
    }

    const now = Date.now();

    if (this.limits.hourly !== undefined) {
      const hourlySpend = this.sumSince(now - ONE_HOUR_MS);
      if (hourlySpend + estimatedCost > this.limits.hourly) {
        return {
          allowed: false,
          blockedBy: "hourly",
          reason: `Hourly spend $${hourlySpend.toFixed(4)} + $${estimatedCost.toFixed(4)} exceeds limit $${this.limits.hourly.toFixed(2)}`,
        };
      }
    }

    if (this.limits.daily !== undefined) {
      const dailySpend = this.sumSince(now - ONE_DAY_MS);
      if (dailySpend + estimatedCost > this.limits.daily) {
        return {
          allowed: false,
          blockedBy: "daily",
          reason: `Daily spend $${dailySpend.toFixed(4)} + $${estimatedCost.toFixed(4)} exceeds limit $${this.limits.daily.toFixed(2)}`,
        };
      }
    }

    return { allowed: true };
  }

  /** Record actual spend after a request completes. */
  record(amount: number, model: string): void {
    this.history.push({ ts: Date.now(), amount, model });
    this.trim();
    this.persist();
  }

  /** Get current spending status for reporting. */
  getStatus(): SpendingStatus {
    const now = Date.now();
    return {
      limits: this.limits,
      hourlySpend: this.sumSince(now - ONE_HOUR_MS),
      dailySpend: this.sumSince(now - ONE_DAY_MS),
      requestCount24h: this.history.filter((r) => r.ts >= now - ONE_DAY_MS).length,
    };
  }

  // ── Private ───────────────────────────────────────────────────

  private sumSince(sinceMs: number): number {
    let total = 0;
    for (const r of this.history) {
      if (r.ts >= sinceMs) total += r.amount;
    }
    return total;
  }

  /** Remove records older than 24 hours. */
  private trim(): void {
    const cutoff = Date.now() - ONE_DAY_MS;
    this.history = this.history.filter((r) => r.ts >= cutoff);
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(raw) as { history?: SpendRecord[] };
        if (Array.isArray(data.history)) {
          this.history = data.history;
        }
      }
    } catch {
      this.history = [];
    }
  }

  private persist(): void {
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify({ history: this.history }, null, 2), "utf-8");
    } catch {
      // Best-effort persistence
    }
  }
}
