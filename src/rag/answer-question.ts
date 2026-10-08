/**
 * Deterministic RAG pipeline over the Local Social Network documents:
 * always retrieve → prompt → LLM. The model does not choose whether to search.
 * Used by the CLI (deterministic-chain.ts) and the golden-set evaluation.
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { searchDocuments } from "../shared/project-docs-store.js";
import type { SearchHit } from "../shared/types.js";

const TOP_K = 4;
const CANDIDATES = 20; // fetched so a missing document's best chunk can be found
const MIN_SCORE_MARGIN = 0.1;
const MIN_SCORE = 0.2; // absolute floor: when everything scores low, a "close" chunk is still junk
const DOCUMENTS = ["app-specification.pdf", "product-discovery.pdf"];

export const NOT_FOUND = "I could not find that in the project documents.";
export const CATEGORIES = ["interview", "use-case", "capability-spec"];

const SYSTEM_PROMPT =
  "You answer questions about the Local Social Network app (Wasn.jetzt) using only the " +
  "numbered context chunks below. They come from two documents: the app specification " +
  "(use cases and capability specs: what the app does) and the product discovery " +
  "(interviews, canvases, decisions: why it exists). " +
  "Answer from the chunks even if the answer must be combined from several of them, " +
  "and cite the chunks you use as [1], [2] directly after the statement. " +
  `Only if none of the chunks contains relevant information, reply exactly: "${NOT_FOUND}" ` +
  "Never answer from general knowledge and never guess.";

export interface AnswerResult {
  question: string;
  category?: string;
  /** Chunks passed to the model, in prompt order ([1] is index 0). */
  hits: SearchHit[];
  context: string;
  answer: string;
  /** The subset of `hits` that the answer cites with [n]. */
  cited: SearchHit[];
}

/** Questions that mention interviews are restricted to the interview chunks. */
export function categoryFor(question: string): string | undefined {
  return /\binterview/i.test(question) ? "interview" : undefined;
}

export async function answerQuestion(
  question: string,
  options: { category?: string; log?: (line: string) => void } = {},
): Promise<AnswerResult> {
  const log = options.log ?? (() => {});
  const category = options.category ?? categoryFor(question);

  const candidates = await searchDocuments({
    query: question,
    filters: category ? { category } : undefined,
    topK: CANDIDATES,
  });
  const hits = selectHits(candidates, !category, log);
  const context = formatContext(hits);

  const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(`Context:\n${context}\n\nQuestion: ${question}`),
  ]);
  const answer =
    typeof response.content === "string" ? response.content : JSON.stringify(response.content);

  return { question, category, hits, context, answer, cited: citedHits(answer, hits) };
}

/**
 * Top TOP_K chunks. Minimum guarantee: if a document is missing from them, its best chunk is
 * added when it scores within MIN_SCORE_MARGIN of the top hit, so cross-document questions see
 * both documents while single-document questions stay free of weak, unrelated chunks.
 */
function selectHits(
  candidates: SearchHit[],
  guaranteeDocuments: boolean,
  log: (line: string) => void,
): SearchHit[] {
  const valid = candidates.filter((h) => h.id !== "none");
  const selected = valid.slice(0, TOP_K);
  if (!guaranteeDocuments || !selected.length) return selected;

  const topScore = selected[0].score ?? 0;
  for (const document of DOCUMENTS) {
    if (selected.some((h) => h.source_file === document)) continue;
    const best = valid.find((h) => h.source_file === document);
    if (!best) {
      log(`Guarantee: no ${document} chunk among the ${CANDIDATES} candidates`);
    } else if ((best.score ?? 0) >= Math.max(topScore - MIN_SCORE_MARGIN, MIN_SCORE)) {
      log(`Guarantee: added ${best.id} (score ${best.score?.toFixed(3)}, top ${topScore.toFixed(3)})`);
      selected.push(best);
    } else {
      log(
        `Guarantee: best ${document} chunk scores ${best.score?.toFixed(3)}, ` +
          `top is ${topScore.toFixed(3)}; needs within ${MIN_SCORE_MARGIN} of it and at least ${MIN_SCORE}, not added`,
      );
    }
  }
  return selected;
}

export function describeSource(hit: SearchHit): string {
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

/** Sources come from the chunks the answer cites, not from what the model claims. */
function citedHits(answer: string, hits: SearchHit[]): SearchHit[] {
  const numbers = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  return hits.filter((_, i) => numbers.has(i + 1));
}

export function formatSources(result: AnswerResult): string[] {
  return result.cited.map((hit) => {
    const n = result.hits.indexOf(hit) + 1;
    const sections = hit.headings?.length ? `\n      sections: ${hit.headings.join(" | ")}` : "";
    return `[${n}] ${describeSource(hit)}  → ${hit.id}${sections}`;
  });
}
