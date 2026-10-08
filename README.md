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

## Ingest

```bash
npm run ingest -- --dry-run   # chunk only, no API calls; writes out/chunks.json for inspection
npm run ingest                # embed with OpenAI and upsert to the own Pinecone namespace
npm run ingest -- --reset     # delete the namespace first (removes stale chunks), then ingest
```

The PDFs have no heading markers, so headings are detected by font size (20 / 15 / 12.5 / 11 pt).
Each original file is recovered from its `Source file:` line.

## Layout

| Path | Purpose |
|------|---------|
| `documents/*.pdf` | The two indexed PDFs (app specification, product discovery) |
| `src/ingest/` | PDF → chunks → embeddings → Pinecone (`ingest.ts`, `chunker.ts`, `pdf-lines.ts`) |
| `src/rag/deterministic-chain.ts` | Retrieval chain (always retrieve → prompt → LLM) |
| `src/shared/project-docs-store.ts` | Pinecone search (embeds the query with `text-embedding-3-small`) |
| `src/shared/types.ts`, `load-env.ts` | Shared types and env loading |

Index: `local-social-network` (1536 dimensions, cosine). Namespace: `lsn-own-rag`.
