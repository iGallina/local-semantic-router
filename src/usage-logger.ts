/**
 * Usage Logger — fire-and-forget JSONL logging for request costs.
 *
 * Writes one JSON line per request to daily files:
 *   ~/.local-semantic-router/logs/usage-YYYY-MM-DD.jsonl
 */

import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ─────────────────────────────────────────────────────────

export interface UsageLogEntry {
  timestamp: string;
  model: string;
  tier: string;
  provider: string;
  streaming: boolean;
  inputTokens: number;
  outputTokens: number;
  actualCost: number;
  estimatedCost: number;
  latencyMs: number;
}

// ── State ─────────────────────────────────────────────────────────

const DEFAULT_LOG_DIR = join(homedir(), ".local-semantic-router", "logs");
let logDirReady = false;
let logDirOverride: string | undefined;

/** Override log directory (for tests). */
export function setLogDir(dir: string | undefined): void {
  logDirOverride = dir;
  logDirReady = false;
}

function getLogDir(): string {
  return logDirOverride ?? DEFAULT_LOG_DIR;
}

async function ensureLogDir(): Promise<void> {
  if (logDirReady) return;
  await mkdir(getLogDir(), { recursive: true });
  logDirReady = true;
}

// ── Logging ───────────────────────────────────────────────────────

function logFileName(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `usage-${yyyy}-${mm}-${dd}.jsonl`;
}

/** Append a usage entry to today's JSONL file. Fire-and-forget. */
export async function logUsage(entry: UsageLogEntry): Promise<void> {
  await ensureLogDir();
  const filePath = join(getLogDir(), logFileName(new Date()));
  const line = JSON.stringify(entry) + "\n";
  await appendFile(filePath, line, "utf-8");
}

// ── Reading ───────────────────────────────────────────────────────

/** Read usage logs for the last N days. */
export async function readUsageLogs(days: number): Promise<UsageLogEntry[]> {
  const logDir = getLogDir();
  const entries: UsageLogEntry[] = [];
  const now = new Date();

  // Collect expected file names
  const fileNames = new Set<string>();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    fileNames.add(logFileName(d));
  }

  let files: string[];
  try {
    files = await readdir(logDir);
  } catch {
    return entries; // logs dir doesn't exist yet
  }

  for (const file of files) {
    if (!fileNames.has(file)) continue;
    try {
      const content = await readFile(join(logDir, file), "utf-8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as UsageLogEntry);
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return entries;
}
