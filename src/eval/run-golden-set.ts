#!/usr/bin/env node
/**
 * Regression test for the RAG pipeline: runs golden/golden-set.json through the chain and
 * checks retrieval, citations, answer content and refusal for each question.
 *
 * Usage:
 *   npm run eval:golden
 *   npm run eval:golden -- --only easy-rick-age,unanswerable-ceo
 *
 * Exit code 1 if any question without `known_issue` fails. Results: out/golden-results.json
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv, ROOT } from "../shared/load-env.js";
import { answerQuestion, NOT_FOUND } from "../rag/answer-question.js";
import type { AnswerResult } from "../rag/answer-question.js";
import type { SearchHit } from "../shared/types.js";

interface GoldenQuestion {
  id: string;
  kind: "easy" | "tricky" | "unanswerable";
  question: string;
  /** Every entry must be among the retrieved chunks. */
  expected_sources_all?: string[];
  /** At least one entry must be among the retrieved chunks. */
  expected_sources_any?: string[];
  /** None of these may be cited. */
  forbidden_sources?: string[];
  answer_contains_all?: string[];
  answer_contains_any?: string[];
  expect_refusal?: boolean;
  /** A known limitation: a failure is reported but does not fail the run. */
  known_issue?: string;
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

type Status = "pass" | "fail" | "known-issue" | "fixed?";

function matches(hit: SearchHit, source: string): boolean {
  return Boolean(hit.document?.includes(source) || hit.source_file?.includes(source));
}

function check(name: string, ok: boolean, detail: string): Check {
  return { name, ok, detail };
}

function evaluate(golden: GoldenQuestion, result: AnswerResult): Check[] {
  const checks: Check[] = [];
  const answer = result.answer.toLowerCase();
  const refused = result.answer.trim().startsWith(NOT_FOUND);

  if (golden.expect_refusal) {
    checks.push(check("refuses", refused, refused ? "refused" : `answered: ${result.answer.slice(0, 80)}`));
    checks.push(check("no citations", result.cited.length === 0, `${result.cited.length} cited`));
    return checks;
  }
  checks.push(check("answers", !refused, refused ? "refused although answerable" : "answered"));

  for (const source of golden.expected_sources_all ?? []) {
    const found = result.hits.some((h) => matches(h, source));
    checks.push(check(`retrieved ${source}`, found, found ? "yes" : "missing among retrieved chunks"));
  }
  if (golden.expected_sources_any?.length) {
    const found = golden.expected_sources_any.filter((s) => result.hits.some((h) => matches(h, s)));
    checks.push(check("retrieved any expected source", found.length > 0, found.join(", ") || "none"));
  }

  const expected = [...(golden.expected_sources_all ?? []), ...(golden.expected_sources_any ?? [])];
  if (expected.length) {
    const cited = result.cited.some((h) => expected.some((s) => matches(h, s)));
    checks.push(check("cites an expected source", cited, cited ? "yes" : "cited sources are not the expected ones"));
  }
  for (const source of golden.forbidden_sources ?? []) {
    const cited = result.cited.some((h) => matches(h, source));
    checks.push(check(`does not cite ${source}`, !cited, cited ? "cited" : "ok"));
  }

  for (const text of golden.answer_contains_all ?? []) {
    checks.push(check(`answer contains "${text}"`, answer.includes(text.toLowerCase()), ""));
  }
  if (golden.answer_contains_any?.length) {
    const hit = golden.answer_contains_any.find((t) => answer.includes(t.toLowerCase()));
    checks.push(check(`answer contains one of ${golden.answer_contains_any.join(" / ")}`, Boolean(hit), hit ?? "none"));
  }
  return checks;
}

function statusOf(golden: GoldenQuestion, checks: Check[]): Status {
  const passed = checks.every((c) => c.ok);
  if (golden.known_issue) return passed ? "fixed?" : "known-issue";
  return passed ? "pass" : "fail";
}

const ICON: Record<Status, string> = { pass: "✓", fail: "✗", "known-issue": "~", "fixed?": "!" };

async function main(): Promise<void> {
  loadEnv();
  if (!process.env.PINECONE_API_KEY) throw new Error("Missing PINECONE_API_KEY — set it in .env");
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY — set it in .env");

  const only = process.argv.includes("--only")
    ? new Set(process.argv[process.argv.indexOf("--only") + 1]?.split(","))
    : undefined;
  const file = JSON.parse(await readFile(join(ROOT, "golden", "golden-set.json"), "utf8")) as {
    questions: GoldenQuestion[];
  };
  const questions = file.questions.filter((q) => !only || only.has(q.id));
  if (!questions.length) throw new Error("No golden questions selected");

  const results: Array<{ id: string; kind: string; status: Status; checks: Check[]; answer: string; cited: string[] }> = [];

  for (const golden of questions) {
    const result = await answerQuestion(golden.question);
    const checks = evaluate(golden, result);
    const status = statusOf(golden, checks);
    results.push({
      id: golden.id,
      kind: golden.kind,
      status,
      checks,
      answer: result.answer,
      cited: result.cited.map((h) => h.id),
    });

    console.log(`${ICON[status]} ${golden.id}  [${golden.kind}]  ${status}`);
    console.log(`    ${golden.question}`);
    if (status !== "pass") {
      for (const c of checks.filter((c) => !c.ok)) console.log(`    ✗ ${c.name}: ${c.detail}`);
      if (golden.known_issue) console.log(`    known issue: ${golden.known_issue}`);
    }
  }

  const count = (s: Status) => results.filter((r) => r.status === s).length;
  console.log(
    `\n${count("pass")} passed · ${count("fail")} failed · ${count("known-issue")} known issues · ${count("fixed?")} known issues now passing (remove known_issue)`,
  );

  await mkdir(join(ROOT, "out"), { recursive: true });
  await writeFile(join(ROOT, "out", "golden-results.json"), JSON.stringify(results, null, 2), "utf8");
  if (count("fail") > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
