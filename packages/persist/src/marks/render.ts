import type { Drawing, MarkRecord } from "@ai-world/shared";

/** The canvas is 100 by 50 units (DESIGN.md section 12). */
export const CANVAS_W = 100;
export const CANVAS_H = 50;

export const ROCK = "#6b655c";
export const PIGMENT_COLORS: Readonly<Record<string, string>> = {
  "brown-yellow": "#b0832f",
  dark: "#26211d",
  red: "#a8392b",
  pale: "#ebe2cb",
};
export const WIDTH_UNITS: Readonly<Record<string, number>> = { thin: 0.8, medium: 1.6, thick: 3.2 };

/** Characters per line when text is wrapped into the canvas. Shared by the vector and raster renderers. */
export const TEXT_COLUMNS = 36;
export const TEXT_ROWS = 8;

export const pigmentColor = (pigment: string | undefined): string => PIGMENT_COLORS[pigment ?? "dark"] ?? PIGMENT_COLORS.dark!;

/** Wrap on spaces, honour newlines, and break words longer than a line. Lines beyond `maxRows` are cut. */
export function wrapText(text: string, columns = TEXT_COLUMNS, maxRows = TEXT_ROWS): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const rawWord of para.split(/ +/)) {
      let word = rawWord;
      while (word.length > columns) {
        if (line) { lines.push(line); line = ""; }
        lines.push(word.slice(0, columns));
        word = word.slice(columns);
      }
      if (line && line.length + 1 + word.length > columns) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines.slice(0, maxRows);
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Remove characters that are not allowed in XML 1.0 so a stray control character can never break the file. */
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

function drawingSvg(drawing: Drawing): string {
  return drawing.strokes.map((s) => {
    const color = pigmentColor(s.pigment);
    const w = WIDTH_UNITS[s.width] ?? 1.6;
    if (s.points.length === 1) {
      const [x, y] = s.points[0]!;
      return `<circle cx="${x}" cy="${y}" r="${w / 2}" fill="${color}"/>`;
    }
    return `<polyline fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" points="${s.points.map((p) => p.join(",")).join(" ")}"/>`;
  }).join("");
}

/** The authoritative, lossless image of a mark. Text is wrapped into the canvas and drawn in the mark's pigment. */
export function renderSvg(mark: Pick<MarkRecord, "content" | "pigment" | "kind">): string {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" width="${CANVAS_W * 4}" height="${CANVAS_H * 4}"><rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${ROCK}"/>`;
  if (typeof mark.content === "string") {
    const lines = wrapText(mark.content.replace(XML_BAD, ""));
    const size = 4.6, lead = 5.4;
    const color = pigmentColor(mark.pigment);
    const body = lines.map((l, i) => `<text x="1.5" y="${(5.5 + i * lead).toFixed(1)}" font-family="monospace" font-size="${size}" fill="${color}" xml:space="preserve">${escapeXml(l)}</text>`).join("");
    return `${head}${body}</svg>\n`;
  }
  return `${head}${drawingSvg(mark.content)}</svg>\n`;
}
