import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseTypedEvent } from "../packages/shared/src/payloads.ts";
import { analyzeLexicon } from "../packages/observatory/src/lexicon/index.ts";

const [input, dictionaryFile] = process.argv.slice(2);
if (!input) throw new Error("Usage: npx tsx tools/export-lexicon.mjs <events.jsonl-or-ws-fixture> [dictionary.txt]");
const text = await readFile(resolve(input), "utf8");
const dictionary = dictionaryFile ? new Set((await readFile(resolve(dictionaryFile), "utf8")).toLowerCase().match(/[\p{L}][\p{L}'-]*/gu) ?? []) : new Set();
const events = text.trim().split(/\r?\n/).flatMap((line) => { const value = JSON.parse(line); return value.type === "event" ? [parseTypedEvent(value.event)] : value.type ? [] : [parseTypedEvent(value)]; });
console.log(JSON.stringify(analyzeLexicon(events, dictionary), null, 2));
