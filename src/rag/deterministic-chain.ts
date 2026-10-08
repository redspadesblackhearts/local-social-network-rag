#!/usr/bin/env node
/**
 * Deterministic RAG over the Local Social Network documents (CLI).
 *
 * Usage:
 *   npm run rag:deterministic
 *   npm run rag:deterministic -- "Why do we require approval to join an activity?"
 *   npm run rag:deterministic -- --category interview "What do users dislike about WhatsApp?"
 *
 * Questions that mention interviews are restricted to the interview chunks automatically;
 * otherwise a topical match elsewhere (e.g. the risk register) outranks the interviews.
 */

import { loadEnv } from "../shared/load-env.js";
import { answerQuestion, CATEGORIES, categoryFor, formatSources } from "./answer-question.js";

const DEFAULT_QUESTION = "What happens when I join an activity that needs approval?";

function parseArgs(argv: string[]): { question: string; category?: string } {
  const words: string[] = [];
  let category: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--category") category = argv[++i];
    else words.push(argv[i]);
  }
  const question = words.join(" ").trim() || DEFAULT_QUESTION;
  if (category && !CATEGORIES.includes(category)) {
    throw new Error(`Unknown --category "${category}". Use one of: ${CATEGORIES.join(", ")}`);
  }
  return { question, category: category ?? categoryFor(question) };
}

async function main(): Promise<void> {
  loadEnv();

  if (!process.env.PINECONE_API_KEY) throw new Error("Missing PINECONE_API_KEY — set it in .env");
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY — set it in .env");

  const { question, category } = parseArgs(process.argv.slice(2));

  console.log("Pattern: Deterministic RAG (retrieve → prompt → LLM)\n");
  console.log(`Question: ${question}`);
  if (category) console.log(`Filter: category = ${category}`);
  console.log("\n→ retrieve (always runs, model does not decide)…");

  const result = await answerQuestion(question, { category, log: console.log });

  console.log("Retrieved context:\n");
  console.log(result.context);
  console.log("\n--- Answer ---\n");
  console.log(result.answer);

  const sources = formatSources(result);
  console.log("\n--- Sources ---\n");
  console.log(sources.length ? sources.join("\n") : "(none cited)");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
