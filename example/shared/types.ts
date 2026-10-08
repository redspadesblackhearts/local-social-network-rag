export interface SearchHit {
  id: string;
  text: string;
  page?: number;
  section?: string;
  section_id?: string;
  score?: number;
  count?: number;
}

export interface SearchDocumentsInput {
  query: string;
  filters?: Record<string, unknown>;
}
