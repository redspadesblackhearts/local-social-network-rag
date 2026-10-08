import { Pinecone } from "@pinecone-database/pinecone";
import type {
  RecordMetadata,
  ScoredPineconeRecord,
} from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { EMBEDDING_MODEL, pineconeConfig } from "./config.js";
import type { SearchDocumentsInput, SearchHit } from "./types.js";

async function getNamespace() {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error("Missing PINECONE_API_KEY");
  const { indexName, namespace } = pineconeConfig();
  const pc = new Pinecone({ apiKey });
  const host = (await pc.describeIndex(indexName)).host;
  return pc.index(indexName, host).namespace(namespace);
}

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  return new OpenAI({ apiKey });
}

async function embedQuery(openai: OpenAI, query: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  });
  return response.data[0].embedding;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hitFromMatch(match: ScoredPineconeRecord<RecordMetadata>): SearchHit {
  const meta = match.metadata ?? {};
  return {
    id: match.id,
    text: text(meta.chunk_text) ?? "",
    score: match.score,
    page: typeof meta.page === "number" ? meta.page : undefined,
    source_file: text(meta.source_file),
    document: text(meta.document),
    doc_title: text(meta.doc_title),
    heading: text(meta.heading),
    category: text(meta.category),
    interviewee: text(meta.interviewee),
  };
}

/** Semantic search over the project documents in the own Pinecone namespace. */
export async function searchDocuments({
  query,
  filters,
}: SearchDocumentsInput): Promise<SearchHit[]> {
  const openai = getOpenAI();
  const ns = await getNamespace();
  const vector = await embedQuery(openai, query);

  const filter =
    filters?.category && typeof filters.category === "string"
      ? { category: { $eq: filters.category } }
      : undefined;

  const results = await ns.query({
    vector,
    topK: 5,
    includeMetadata: true,
    ...(filter ? { filter } : {}),
  });

  const hits = (results.matches ?? [])
    .filter((m) => m.metadata?.chunk_text)
    .map((m) => hitFromMatch(m as ScoredPineconeRecord<RecordMetadata>));

  return hits.length
    ? hits
    : [{ id: "none", text: "No matching chunks.", count: 0 }];
}
