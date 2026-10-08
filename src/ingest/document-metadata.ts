export interface DocumentMetadata {
  category: string;
  interviewee?: string;
}

/** Derives the filterable metadata from the original file path in the `Source file:` line. */
export function documentMetadata(document: string): DocumentMetadata {
  const interview = document.match(/user-interview-([a-z]+)\.en\.md$/i);
  if (interview) {
    const name = interview[1];
    return {
      category: "interview",
      interviewee: name.charAt(0).toUpperCase() + name.slice(1),
    };
  }
  if (document.startsWith("doc/use-case/")) return { category: "use-case" };
  if (document.startsWith("openspec/specs/")) return { category: "capability-spec" };
  if (document === "doc/mvp-requirements.md") return { category: "mvp-requirements" };

  const discovery = document.match(/^doc\/product-discovery\/([^/]+)(?:\/|$)/);
  if (discovery) return { category: discovery[1].replace(/\.md$/, "") };
  return { category: "other" };
}
