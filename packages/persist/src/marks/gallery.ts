import type { MarkRecord } from "@ai-world/shared";
import { escapeXml } from "./render";

/** Static page listing every mark in order, flat, with the owner-facing metadata. Safe to regenerate at any time. */
export function renderGallery(marks: readonly MarkRecord[]): string {
  const cards = marks.map((m) => {
    const body = typeof m.content === "string"
      ? `<blockquote>${escapeXml(m.content)}</blockquote>`
      : `<p class="muted">drawing: ${m.content.strokes.length} stroke(s), ${m.content.strokes.reduce((n, s) => n + s.points.length, 0)} point(s)</p>`;
    return `<article id="mark-${m.mark_id}">
<h2>Mark ${m.mark_id} <span class="muted">${m.kind}</span></h2>
<a href="marks/${m.mark_id}.svg"><img src="marks/${m.mark_id}.png" alt="Mark ${m.mark_id}" width="432" height="216"></a>
${body}
<p class="muted">day ${m.game_day}, beat ${m.beat} · wall slot ${m.wall_slot} · author ${escapeXml(m.author_slot)} (${escapeXml(m.author_mind_id)}) · witnesses: ${m.witnesses.length}</p>
<p class="muted"><a href="marks/${m.mark_id}.json">record</a> · <a href="marks/${m.mark_id}.svg">vector</a></p>
</article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cave marks</title>
<style>:root{color-scheme:light dark}body{font:15px/1.4 system-ui,sans-serif;margin:2rem auto;max-width:960px;padding:0 1rem}article{border-top:1px solid #8884;padding:1rem 0}img{max-width:100%;height:auto;background:#6b655c}blockquote{margin:.5rem 0;white-space:pre-wrap}.muted{opacity:.7;font-size:13px}</style></head>
<body><h1>Cave marks</h1><p class="muted">${marks.length} mark(s). This page is regenerated after every commit. Owner view: it shows internal author fields.</p>
${cards}
</body></html>
`;
}
