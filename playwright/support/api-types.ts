// Types for the dashboard API's responses. They mirror the JSON Schemas in
// playwright/api/schemas.ts: the schemas check responses at runtime, these types
// check the test code at compile time.

export type Engine = 'selenium' | 'playwright';

export interface TestListItem {
  name: string;
  description: string;
  engine: Engine;
  /** Group shown on the dashboard, e.g. "Login" or "Banking". */
  area: string;
}

export interface LogEvent {
  type: 'log';
  test: string;
  message: string;
}

export interface ResultEvent {
  type: 'result';
  name: string;
  passed: boolean;
  message: string;
  durationMs: number;
  runId?: number;
}

export type StreamEvent = LogEvent | ResultEvent;

export interface Run {
  id: number;
  name: string;
  engine: Engine;
  passed: boolean;
  message: string;
  durationMs: number;
  startedAt: string;
}

export interface TestStats {
  name: string;
  engine: Engine;
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  avgDurationMs: number;
  lastRunAt: string;
  flaky: boolean;
}

export interface RecordingSummary {
  name: string;
  steps: number;
  updatedAt: string;
}
