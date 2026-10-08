# local-social-network-rag

Own RAG exercise for the Local Social Network project. Trimmed from the
[dl-school-agentic](https://github.com/drublic/dl-school-agentic) workshop repo: only the
deterministic retrieval chain and its shared modules are kept.

## Goal

Index two own PDFs (app specification, product discovery) in an own Pinecone namespace and
answer questions from them: retrieve → prompt → LLM, with citations and a refusal for
questions the documents cannot answer.

## Setup

```bash
cp env.example .env   # fill in PINECONE_API_KEY and OPENAI_API_KEY
npm install
npm run typecheck
```

`.env` is git-ignored. Never commit keys.

## Layout

| Path | Purpose |
|------|---------|
| `example/rag/deterministic-chain.ts` | Retrieval chain (always retrieve → prompt → LLM) |
| `example/shared/handbook-store.ts` | Pinecone search (embeds the query with `text-embedding-3-small`) |
| `example/shared/types.ts`, `load-env.ts` | Shared types and env loading |

Index: `local-social-network` (1536 dimensions, cosine). Namespace: `lsn-own-rag`.
