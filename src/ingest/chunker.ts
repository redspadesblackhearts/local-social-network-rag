import { basename } from "node:path";
import { documentMetadata } from "./document-metadata.js";
import type { PdfLine } from "./pdf-lines.js";

export interface Chunk {
  id: string;
  chunk_index: number;
  source_file: string;
  document: string;
  doc_title: string;
  /** Heading path of the first section in the chunk. */
  heading: string;
  /** Heading paths of all sections packed into the chunk. */
  headings: string[];
  category: string;
  interviewee?: string;
  page: number;
  /** `Title > Heading` prefix plus body: this is what gets embedded and returned. */
  chunk_text: string;
}

/** Heading sizes in the PDFs (pt), set by the CSS of the PDF build: h1 20, h2 15, h3 12.5, h4 11. */
const HEADING_SIZES = [20, 15, 12.5, 11];
const SIZE_TOLERANCE = 0.15;

const TARGET_CHARS = 1600; // ~400 tokens: consecutive small sections are packed up to this size
const MAX_CHARS = 3200; // ~800 tokens at ~4 chars per token: a single section is split above this
const OVERLAP_CHARS = 400; // ~100 tokens
const SOURCE_FILE = /^Source file:\s*(.+)$/;

interface Section {
  heading: string;
  page: number;
  lines: string[];
}

interface SourceDocument {
  path: string;
  title: string;
  sections: Section[];
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkPdf(sourceFile: string, lines: PdfLine[]): Chunk[] {
  const documents = splitIntoDocuments(lines);
  const slugs = documentSlugs(documents.map((d) => d.path));

  return documents.flatMap((doc) => {
    const meta = documentMetadata(doc.path);
    const parts = doc.sections.flatMap((section) =>
      splitLongText(section.lines.join("\n")).map((text) => ({
        heading: section.heading,
        page: section.page,
        text,
      })),
    );
    return pack(parts).map((group, index) => ({
      id: `${stem(sourceFile)}-${slugs.get(doc.path)}-${String(index + 1).padStart(2, "0")}`,
      chunk_index: index + 1,
      source_file: sourceFile,
      document: doc.path,
      doc_title: doc.title,
      heading: group[0].heading,
      headings: [...new Set(group.map((part) => part.heading))],
      page: group[0].page,
      chunk_text: render(doc.title, group),
      ...meta,
    }));
  });
}

interface Part {
  heading: string;
  page: number;
  text: string;
}

/** Packs consecutive small sections of one file into chunks of about TARGET_CHARS. */
function pack(parts: Part[]): Part[][] {
  const groups: Part[][] = [];
  let current: Part[] = [];
  let length = 0;
  for (const part of parts) {
    if (current.length > 0 && length + part.text.length > TARGET_CHARS) {
      groups.push(current);
      current = [];
      length = 0;
    }
    current.push(part);
    length += part.text.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** `Title > Heading` leads the chunk; further sections keep their own heading inside the text. */
function render(title: string, group: Part[]): string {
  const [first, ...rest] = group;
  const sections = [first.text, ...rest.map((p) => `### ${p.heading}\n${p.text}`)];
  return `${title} > ${first.heading}\n\n${sections.join("\n\n")}`;
}

/** A PDF merges many files: the `Source file:` line marks where each original file starts. */
function splitIntoDocuments(lines: PdfLine[]): SourceDocument[] {
  const documents: SourceDocument[] = [];
  let doc: SourceDocument | undefined;
  let section: Section | undefined;
  let headings: string[] = [];
  let previousHeading: { level: number; line: PdfLine } | undefined;

  const startSection = (heading: string, page: number) => {
    section = { heading, page, lines: [] };
    doc?.sections.push(section);
  };

  for (const line of lines) {
    const source = line.text.match(SOURCE_FILE);
    if (source) {
      doc = { path: source[1].trim(), title: "", sections: [] };
      documents.push(doc);
      section = undefined;
      headings = [];
      previousHeading = undefined;
      continue;
    }
    if (!doc) continue;

    const level = headingLevel(line.size);
    if (level === undefined) {
      if (!section) startSection(doc.title || doc.path, line.page);
      section!.lines.push(line.text);
      previousHeading = undefined;
      continue;
    }

    if (previousHeading && isWrappedHeading(previousHeading, level, line)) {
      headings[level - 1] += ` ${line.text}`;
    } else {
      headings = [...headings.slice(0, level - 1), line.text];
    }
    previousHeading = { level, line };
    if (level === 1) doc.title = headings[0];
    startSection(headings.slice(1).join(" > ") || doc.title, line.page);
  }
  return documents.map((d) => ({
    ...d,
    sections: d.sections.filter((s) => s.lines.length > 0),
  }));
}

function headingLevel(size: number): number | undefined {
  const index = HEADING_SIZES.findIndex((s) => Math.abs(s - size) <= SIZE_TOLERANCE);
  return index === -1 ? undefined : index + 1;
}

/** A long heading wraps onto a second line of the same size, closely below the first. */
function isWrappedHeading(
  previous: { level: number; line: PdfLine },
  level: number,
  line: PdfLine,
): boolean {
  return (
    previous.level === level &&
    previous.line.page === line.page &&
    previous.line.y - line.y < line.size * 1.7
  );
}

/** Keeps short sections whole; splits long ones at line breaks with overlap. */
function splitLongText(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];

  const pieces = text.split("\n").flatMap(splitLongLine);
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;

  for (const piece of pieces) {
    if (length + piece.length > MAX_CHARS && current.length > 0) {
      chunks.push(current.join("\n"));
      current = overlapTail(current);
      length = current.join("\n").length;
    }
    current.push(piece);
    length += piece.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

function overlapTail(pieces: string[]): string[] {
  const tail: string[] = [];
  let length = 0;
  for (let i = pieces.length - 1; i >= 0 && length < OVERLAP_CHARS; i--) {
    tail.unshift(pieces[i]);
    length += pieces[i].length + 1;
  }
  return tail;
}

function splitLongLine(line: string): string[] {
  if (line.length <= MAX_CHARS) return [line];
  return line.match(/[^.!?]+[.!?]*\s*/g) ?? [line];
}

function stem(file: string): string {
  return basename(file).replace(/\.[^.]+$/, "");
}

/** `<name>` of the original file; `<folder>-<name>` where names collide (e.g. all `spec.md`). */
function documentSlugs(paths: string[]): Map<string, string> {
  const names = paths.map((p) => stem(p));
  return new Map(
    paths.map((path, i) => {
      const unique = names.filter((n) => n === names[i]).length === 1;
      const parent = path.split("/").at(-2) ?? "";
      return [path, unique ? names[i] : `${parent}-${names[i]}`];
    }),
  );
}
