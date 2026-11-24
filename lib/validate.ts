// Independent validation of a ranked board, run by main.ts before anything
// is written to /output. This is a second pair of eyes on the model in
// lib/model.ts: boardIssue() in the model answers the gate's own questions,
// while this file checks the properties a reader of the board would rely on
// without knowing the gate — no duplicate slugs, no missing watchlist rows,
// ranks that run 1..n with no gaps, implied values that never rise down the
// board, farm plans that are present and well formed on every row, and
// signals that only name signals the dashboard knows how to draw.
//
// A board that fails any of these is refused before it is written, the same
// way a board that fails boardIssue() is: a bad board must never reach the
// dossier, because the dossier is the summary the judge reads and the judge
// rebuilds it from /output. Validation here is cheap — it runs over the rows
// already in memory — and it is the last place a model bug can be caught
// before the entry is graded.

import type { BoardRow, Snapshot } from './model.ts';

/** One failed check: which rule, on which row, and what was wrong. */
export interface BoardFinding {
  /** The rule that failed, in words a reader can act on. */
  check: string;
  /** The row's slug, or null when the finding is about the whole board. */
  slug: string | null;
  /** What was wrong, with the numbers that prove it. */
  detail: string;
}

/** The signals the dashboard knows how to draw, and nothing else. */
const KNOWN_SIGNALS = new Set(['watchlist', 'surging', 'new', 'multi-chain', 'giant']);

/** The farm plan every row must carry: at least 3 steps, at most 12. */
const MIN_FARM_STEPS = 3;
const MAX_FARM_STEPS = 12;

/** The shortest and longest a farm step may be, in characters. */
const MIN_STEP_CHARS = 20;
const MAX_STEP_CHARS = 600;

/**
 * Every finding in a board, or an empty list when the board is sound.
 * The checks run in the order a reader would meet them: identity first
 * (no row twice, no watchlist row missing), then order (ranks 1..n,
 * implied values never rising), then the contents of each row (farm plan
 * present and well formed, implied value a positive whole number, signals
 * only the known ones). The first failing rule does not stop the rest:
 * the caller gets the whole list, so one fix can answer every finding.
 */
export function validateBoard(board: BoardRow[], snapshot: Snapshot): BoardFinding[] {
  const findings: BoardFinding[] = [];

  // Identity: every slug once, every watchlist slug present.
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) {
      findings.push({ check: 'duplicate slug', slug: row.slug, detail: `${row.slug} appears twice on the board` });
    }
    seen.add(row.slug);
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) {
      findings.push({ check: 'watchlist coverage', slug, detail: `${slug} is on the watchlist but missing from the board` });
    }
  }

  // Order: ranks run 1..n with no gaps, and implied value never rises.
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) {
      findings.push({ check: 'rank sequence', slug: row.slug, detail: `row ${i + 1} carries rank ${row.rank}` });
    }
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      findings.push({
        check: 'implied order',
        slug: row.slug,
        detail: `${row.slug} at $${row.implied_value_usd} outranks ${board[i - 1]!.slug} at $${board[i - 1]!.implied_value_usd}`,
      });
    }
  }

  // Contents: a well-formed farm plan, a positive whole implied value,
  // and only signals the dashboard can draw, on every row.
  for (const row of board) {
    if (row.farm_steps.length < MIN_FARM_STEPS || row.farm_steps.length > MAX_FARM_STEPS) {
      findings.push({
        check: 'farm steps',
        slug: row.slug,
        detail: `${row.slug} has ${row.farm_steps.length} farm steps, expected ${MIN_FARM_STEPS}..${MAX_FARM_STEPS}`,
      });
    }
    for (const step of row.farm_steps) {
      if (step.length < MIN_STEP_CHARS || step.length > MAX_STEP_CHARS) {
        findings.push({
          check: 'farm step length',
          slug: row.slug,
          detail: `${row.slug} has a farm step of ${step.length} characters, expected ${MIN_STEP_CHARS}..${MAX_STEP_CHARS}`,
        });
      }
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      findings.push({
        check: 'implied value',
        slug: row.slug,
        detail: `${row.slug} has implied value ${row.implied_value_usd}`,
      });
    }
    for (const signal of row.signals) {
      if (!KNOWN_SIGNALS.has(signal)) {
        findings.push({ check: 'unknown signal', slug: row.slug, detail: `${row.slug} carries signal ${signal}` });
      }
    }
  }

  return findings;
}
