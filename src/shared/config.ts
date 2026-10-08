export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSION = 1536;

/** Read lazily: `loadEnv()` runs after module imports, so env must not be read at import time. */
export function pineconeConfig(): { indexName: string; namespace: string } {
  return {
    indexName: process.env.WORKSHOP_PINECONE_INDEX || "local-social-network",
    namespace: process.env.WORKSHOP_PINECONE_NAMESPACE || "lsn-own-rag",
  };
}
