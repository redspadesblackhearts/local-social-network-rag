#!/usr/bin/env node
/**
 * Ingest the PDFs in documents/ into the own Pinecone namespace.
 *
 * PDF → lines (with font size) → chunks (per source file, per heading) → embeddings → upsert.
 *
 * Usage:
 *   npm run ingest -- --dry-run            chunk only, no API calls; writes out/chunks.json
 *   npm run ingest                         embed + upsert
 *   npm run ingest -- --reset              delete the namespace first (removes stale chunks)
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Pinecone } from "@pinecone-database/pinecone";
import type { RecordMetadata } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL, pineconeConfig } from "../shared/config.js";
import { loadEnv, ROOT } from "../shared/load-env.js";
import { chunkPdf, estimateTokens } from "./chunker.js";
import type { Chunk } from "./chunker.js";
import { readPdfLines } from "./pdf-lines.js";

const DOCUMENTS_DIR = join(ROOT, "documents");
const OUT_FILE = join(ROOT, "out", "chunks.json");
const BATCH_SIZE = 100;
const PRICE_PER_MILLION_TOKENS = 0.02; // text-embedding-3-small
const PROTECTED_NAMESPACES = ["workshop-shared"];

async function loadChunks(): Promise<Chunk[]> {
  const files = (await readdir(DOCUMENTS_DIR)).filter((f) => f.endsWith(".pdf")).sort();
  if (!files.length) throw new Error(`No PDFs found in ${DOCUMENTS_DIR}`);

  const chunks: Chunk[] = [];
  for (const file of files) {
    const lines = await readPdfLines(join(DOCUMENTS_DIR, file));
    chunks.push(...chunkPdf(file, lines));
  }
  assertUniqueIds(chunks);
  return chunks;
}

function assertUniqueIds(chunks: Chunk[]): void {
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (seen.has(chunk.id)) throw new Error(`Duplicate chunk id: ${chunk.id}`);
    seen.add(chunk.id);
  }
}

function printSummary(chunks: Chunk[]): void {
  const tokens = chunks.map((c) => estimateTokens(c.chunk_text)).sort((a, b) => a - b);
  const total = tokens.reduce((sum, t) => sum + t, 0);
  const percentile = (p: number) => tokens[Math.min(tokens.length - 1, Math.floor(tokens.length * p))];

  console.log(`\n${chunks.length} chunks, ~${total} tokens in total`);
  console.log(
    `tokens per chunk: min ${tokens[0]} · median ${percentile(0.5)} · p90 ${percentile(0.9)} · max ${tokens.at(-1)}`,
  );
  console.log(`embedding cost ≈ $${((total / 1e6) * PRICE_PER_MILLION_TOKENS).toFixed(4)}`);

  const count = (key: (c: Chunk) => string) =>
    [...chunks.reduce((m, c) => m.set(key(c), (m.get(key(c)) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}: ${n}`)
      .join(" · ");
  console.log(`\nper PDF:      ${count((c) => c.source_file)}`);
  console.log(`per category: ${count((c) => c.category)}`);
  console.log(`documents:    ${new Set(chunks.map((c) => c.document)).size}`);

  const noHeading = chunks.filter((c) => c.heading === c.doc_title).length;
  console.log(`chunks without sub-heading (title only): ${noHeading}`);
}

function metadataOf(chunk: Chunk): RecordMetadata {
  const { id, interviewee, ...rest } = chunk;
  return {
    ...rest,
    // Keys the workshop retrieval code reads:
    section: chunk.heading,
    section_id: id,
    ...(interviewee ? { interviewee } : {}),
  };
}

async function embed(openai: OpenAI, texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  return response.data.sort((a, b) => a.index - b.index).map((row) => row.embedding);
}

async function upload(chunks: Chunk[], reset: boolean): Promise<void> {
  const pineconeKey = process.env.PINECONE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!pineconeKey) throw new Error("Missing PINECONE_API_KEY — set it in .env");
  if (!openaiKey) throw new Error("Missing OPENAI_API_KEY — set it in .env");

  const { indexName, namespace } = pineconeConfig();
  if (PROTECTED_NAMESPACES.includes(namespace)) {
    throw new Error(`Refusing to write to the shared workshop namespace "${namespace}"`);
  }

  const pc = new Pinecone({ apiKey: pineconeKey });
  const description = await pc.describeIndex(indexName);
  if (description.dimension !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Index "${indexName}" has dimension ${description.dimension}, expected ${EMBEDDING_DIMENSION} (${EMBEDDING_MODEL})`,
    );
  }
  const ns = pc.index(indexName, description.host).namespace(namespace);
  const openai = new OpenAI({ apiKey: openaiKey });

  if (reset) {
    console.log(`Deleting all vectors in ${indexName}/${namespace}…`);
    await ns.deleteAll();
  }

  console.log(`Embedding and upserting ${chunks.length} chunks to ${indexName}/${namespace}…`);
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await embed(openai, batch.map((c) => c.chunk_text));
    await ns.upsert({
      records: batch.map((chunk, j) => ({
        id: chunk.id,
        values: embeddings[j],
        metadata: metadataOf(chunk),
      })),
    });
    console.log(`  ${Math.min(i + BATCH_SIZE, chunks.length)} / ${chunks.length}`);
  }

  const sample = chunks.filter((_, i) => i % Math.ceil(chunks.length / 20) === 0);
  const fetched = await ns.fetch({ ids: sample.map((c) => c.id) });
  const missing = sample.filter((c) => !fetched.records?.[c.id]);
  if (missing.length) {
    throw new Error(`Verification failed, not found: ${missing.map((c) => c.id).join(", ")}`);
  }
  const stats = await ns.describeIndexStats?.();
  console.log(`✓ Upserted ${chunks.length} chunks (spot check of ${sample.length} passed)`);
  if (stats) console.log(JSON.stringify(stats));
}

async function main(): Promise<void> {
  loadEnv();
  const args = new Set(process.argv.slice(2));
  const chunks = await loadChunks();

  await mkdir(join(ROOT, "out"), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(chunks, null, 2), "utf8");
  printSummary(chunks);
  console.log(`\nChunks written to ${OUT_FILE}`);

  if (args.has("--dry-run")) {
    console.log("Dry run: no embeddings created, nothing uploaded.");
    return;
  }
  await upload(chunks, args.has("--reset"));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
