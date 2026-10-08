#!/usr/bin/env node
/**
 * Deterministic RAG over the Local Social Network documents — fixed pipeline:
 * always retrieve → prompt → LLM. The model does not choose whether to search.
 *
 * Usage:
 *   npm run rag:deterministic
 *   npm run rag:deterministic -- "Why do we require approval to join an activity?"
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { loadEnv } from "../shared/load-env.js";
import { searchDocuments } from "../shared/project-docs-store.js";
import type { SearchHit } from "../shared/types.js";

const DEFAULT_QUESTION = "What happens when I join an activity that needs approval?";

const TOP_K = 4;
const NOT_FOUND = "I could not find that in the project documents.";

const SYSTEM_PROMPT =
  "You answer questions about the Local Social Network app (Wasn.jetzt) using only the " +
  "numbered context chunks below. They come from two documents: the app specification " +
  "(use cases and capability specs: what the app does) and the product discovery " +
  "(interviews, canvases, decisions: why it exists). " +
  "Answer from the chunks even if the answer must be combined from several of them, " +
  "and cite the chunks you use as [1], [2] directly after the statement. " +
  `Only if none of the chunks contains relevant information, reply exactly: "${NOT_FOUND}" ` +
  "Never answer from general knowledge and never guess.";

function usableHits(hits: SearchHit[]): SearchHit[] {
  return hits.filter((h) => h.id !== "none").slice(0, TOP_K);
}

function describeSource(hit: SearchHit): string {
  const who = hit.interviewee ? ` (${hit.interviewee})` : "";
  return [
    `${hit.source_file ?? "unknown"}${who}`,
    hit.document,
    hit.heading,
    hit.page != null ? `p.${hit.page}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatContext(hits: SearchHit[]): string {
  if (!hits.length) return "No matching chunks were retrieved.";
  return hits
    .map((h, i) => {
      const score = h.score != null ? ` (score ${h.score.toFixed(3)})` : "";
      return `[${i + 1}] ${describeSource(h)}${score}\n${h.text}`;
    })
    .join("\n\n");
}

/** Sources are listed from the chunks the answer cites, not from what the model claims. */
function citedSources(answer: string, hits: SearchHit[]): string[] {
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  return hits
    .map((h, i) => ({ n: i + 1, hit: h }))
    .filter(({ n }) => cited.has(n))
    .map(({ n, hit }) => `[${n}] ${describeSource(hit)}  → ${hit.id}`);
}

async function main(): Promise<void> {
  loadEnv();

  if (!process.env.PINECONE_API_KEY) throw new Error("Missing PINECONE_API_KEY — set it in .env");
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY — set it in .env");

  const question = process.argv.slice(2).join(" ").trim() || DEFAULT_QUESTION;

  console.log("Pattern: Deterministic RAG (retrieve → prompt → LLM)\n");
  console.log(`Question: ${question}\n`);

  console.log("→ retrieve (always runs, model does not decide)…");
  const hits = usableHits(await searchDocuments({ query: question }));
  const context = formatContext(hits);

  console.log("Retrieved context:\n");
  console.log(context);
  console.log();

  const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(`Context:\n${context}\n\nQuestion: ${question}`),
  ]);

  const answer =
    typeof response.content === "string" ? response.content : JSON.stringify(response.content);

  console.log("--- Answer ---\n");
  console.log(answer);

  const sources = citedSources(answer, hits);
  console.log("\n--- Sources ---\n");
  console.log(sources.length ? sources.join("\n") : "(none cited)");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
