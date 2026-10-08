#!/usr/bin/env node
/**
 * Deterministic RAG — fixed pipeline: always retrieve → prompt → LLM.
 *
 * The host always calls search before generation. The model does NOT choose
 * whether to search (contrast with example:rag / langchain-handbook-agent.ts).
 *
 * Usage:
 *   npm run example:rag:deterministic
 *   npm run example:rag:deterministic -- "How many PTO days do we get?"
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { loadEnv } from "../shared/load-env.js";
import { searchDocuments } from "../shared/handbook-store.js";
import type { SearchHit } from "../shared/types.js";

const DEFAULT_QUESTION =
  "How many remote work days per month are allowed?";

const TOP_K = 3;
const DECOY_ID = "handbook-p12-bad-parse-decoy";

function formatContext(hits: SearchHit[]): string {
  const usable = hits.filter((h) => h.id !== "none" && h.id !== DECOY_ID);
  if (!usable.length) {
    return "No matching handbook chunks were retrieved.";
  }

  return usable
    .slice(0, TOP_K)
    .map((h, i) => {
      const cite = [h.section_id, h.section, h.page != null ? `p.${h.page}` : null]
        .filter(Boolean)
        .join(" · ");
      const score =
        h.score != null ? ` (score ${h.score.toFixed(3)})` : "";
      return `[${i + 1}] ${cite}${score}\n${h.text}`;
    })
    .join("\n\n");
}

async function main(): Promise<void> {
  loadEnv();

  if (!process.env.PINECONE_API_KEY) {
    throw new Error("Missing PINECONE_API_KEY — set in dl-agentic/.env");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY — set in dl-agentic/.env");
  }

  const question =
    process.argv.slice(2).join(" ").trim() || DEFAULT_QUESTION;

  console.log("Pattern: Deterministic RAG (retrieve → prompt → LLM)\n");
  console.log(`Question: ${question}\n`);

  console.log("→ retrieve (always runs, model does not decide)…");
  const hits = await searchDocuments({ query: question });
  const context = formatContext(hits);

  console.log("Retrieved context:\n");
  console.log(context);
  console.log();

  const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });

  const response = await llm.invoke([
    new SystemMessage(
      "Answer only from the context below. Cite section and page when stating policy. " +
        "If the context does not contain the answer, say you could not find it in the handbook.",
    ),
    new HumanMessage(`Context:\n${context}\n\nQuestion: ${question}`),
  ]);

  const answer =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  console.log("--- Answer ---\n");
  console.log(answer);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
