import { Pinecone } from "@pinecone-database/pinecone";
import type {
  RecordMetadata,
  ScoredPineconeRecord,
} from "@pinecone-database/pinecone";
import OpenAI from "openai";
import type { SearchDocumentsInput, SearchHit } from "./types.js";

const INDEX_NAME =
  process.env.WORKSHOP_PINECONE_INDEX ?? "local-social-network";
const NAMESPACE = process.env.WORKSHOP_PINECONE_NAMESPACE ?? "lsn-own-rag";
const EMBEDDING_MODEL = "text-embedding-3-small";

async function getNamespace() {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error("Missing PINECONE_API_KEY");
  const pc = new Pinecone({ apiKey });
  const host = (await pc.describeIndex(INDEX_NAME)).host;
  return pc.index(INDEX_NAME, host).namespace(NAMESPACE);
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

function hitFromMatch(match: ScoredPineconeRecord<RecordMetadata>): SearchHit {
  const meta = match.metadata ?? {};
  return {
    id: match.id,
    text: typeof meta.chunk_text === "string" ? meta.chunk_text : "",
    page: typeof meta.page === "number" ? meta.page : undefined,
    section: typeof meta.section === "string" ? meta.section : undefined,
    section_id:
      typeof meta.section_id === "string" ? meta.section_id : undefined,
    score: match.score,
  };
}

/** Semantic search over seeded Pinecone vectors (shared by RAG + MCP examples). */
export async function searchDocuments({
  query,
  filters,
}: SearchDocumentsInput): Promise<SearchHit[]> {
  const openai = getOpenAI();
  const ns = await getNamespace();
  const vector = await embedQuery(openai, query);

  const filter =
    filters?.section && typeof filters.section === "string"
      ? { section: { $eq: filters.section } }
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
