import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfLine {
  text: string;
  /** Font size in pt: the signal for headings, since a PDF has no `#` markers. */
  size: number;
  /** Baseline position on the page; used to tell a wrapped heading from two headings. */
  y: number;
  page: number;
}

const SAME_LINE_TOLERANCE = 2;
const LIST_MARKER = /^(?:[•◦▪‣·-]|\d+[.)])$/;

/** Extracts visual lines (text runs on one baseline) with their font size and page. */
export async function readPdfLines(path: string): Promise<PdfLine[]> {
  const data = new Uint8Array(await readFile(path));
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;
  const lines: PdfLine[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const { items } = await page.getTextContent();

    let current: PdfLine | undefined;
    let previousEnd = 0;
    let previousText = "";

    for (const item of items) {
      if (!("str" in item) || !item.str.trim()) continue;

      const [, , c, d, x, rawY] = item.transform;
      const size = Math.round(Math.hypot(c, d) * 10) / 10;
      const y = Math.round(rawY);

      if (current && Math.abs(current.y - y) < SAME_LINE_TOLERANCE) {
        current.text += separator(x - previousEnd, previousText) + item.str;
        current.size = Math.max(current.size, size);
      } else {
        if (current) lines.push(current);
        current = { text: item.str, size, y, page: pageNumber };
      }
      previousEnd = x + item.width;
      previousText = item.str.trim();
    }
    if (current) lines.push(current);
  }
  return lines;
}

/** Table cells and list markers sit in separate runs: re-insert the gap between them. */
function separator(gap: number, previousText: string): string {
  if (LIST_MARKER.test(previousText)) return " ";
  if (gap > 8) return " | ";
  if (gap > 1) return " ";
  return "";
}
