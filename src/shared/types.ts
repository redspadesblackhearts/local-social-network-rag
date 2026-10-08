export interface SearchHit {
  /** Chunk id, e.g. `app-specification-join-activity-use-case-01`. */
  id: string;
  text: string;
  score?: number;
  page?: number;
  source_file?: string;
  document?: string;
  doc_title?: string;
  heading?: string;
  /** Heading paths of every section packed into the chunk. */
  headings?: string[];
  category?: string;
  interviewee?: string;
  count?: number;
}

export interface SearchDocumentsInput {
  query: string;
  filters?: Record<string, unknown>;
  /** Number of candidates to fetch (default 5). */
  topK?: number;
}
