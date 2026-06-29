// Common types shared across all commands

export interface MoleVersion {
  version: string;
  installed: boolean;
  path: string;
}

export type CommandStatus =
  | "idle"
  | "scanning"
  | "preview"
  | "confirming"
  | "executing"
  | "complete"
  | "error";

export interface ProgressEvent {
  type: "progress";
  section: string;
  message: string;
  percent?: number;
}

export interface ItemEvent {
  type: "item";
  section: string;
  description: string;
  size_kb: number;
  size_human: string;
  status: "cleaned" | "dry_run" | "skipped" | "failed";
}

export interface SummaryEvent {
  type: "summary";
  command: string;
  dry_run: boolean;
  total_size_kb: number;
  total_files: number;
  total_categories: number;
  free_space_kb?: number;
  whitelist_patterns?: number;
  timestamp: string;
}

export interface ErrorEvent {
  type: "error";
  code: string;
  message: string;
}

export type MoleEvent = ProgressEvent | ItemEvent | SummaryEvent | ErrorEvent;

export function formatSize(sizeKb: number): string {
  if (sizeKb < 1024) return `${sizeKb}KB`;
  if (sizeKb < 1024 * 1024) {
    const mb = sizeKb / 1024;
    return mb < 10 ? `${mb.toFixed(1)}MB` : `${Math.round(mb)}MB`;
  }
  const gb = sizeKb / (1024 * 1024);
  return gb < 10 ? `${gb.toFixed(1)}GB` : `${Math.round(gb)}GB`;
}

export function formatCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
