// Translation worker. Reads a batch of texts, translates each with a local
// TranslateGemma model served by llama.cpp, checks the result and writes it
// back. It knows nothing about where the texts come from.
//
// Input  (JSON): { "items": [ { "key": "...", "src": "de", "lang": "ru", "lines": ["..."], "method": "block" | "lines" } ] }
// Output (JSON): { "model": "...", "stats": {...}, "items": [ { "key": "...", "out": [...] | null, "error": "..." | null } ] }
//
// Text never goes to the log: only counts and timings do.
//
//   node worker.mjs --in batch.json --out result.json --model translategemma-12b-q4 [--budget-min 300]
//   env: LLAMA_URL (default http://127.0.0.1:8080)

import { readFile, writeFile } from "node:fs/promises";
import { validate } from "./validate.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "1" : all[i + 1]]] : a), []));
const LLAMA = process.env.LLAMA_URL || "http://127.0.0.1:8080";
const MODEL = args.model || "unknown";
const BUDGET_MS = Number(args["budget-min"] || 300) * 60000;
const NAMES = { de: "German", en: "English", ru: "Russian", uk: "Ukrainian" };
const CHUNK = 8;
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

class ModelError extends Error {}

function prompt(src, lang, text) {
  // The prompt from the TranslateGemma model card, in Gemma's turn format.
  const s = NAMES[src], t = NAMES[lang];
  return `<start_of_turn>user\nYou are a professional ${s} (${src}) to ${t} (${lang}) translator. Your goal is to accurately convey the meaning and nuances of the original ${s} text while adhering to ${t} grammar, vocabulary, and cultural sensitivities.\nProduce only the ${t} translation, without any additional explanations or commentary. Please translate the following ${s} text into ${t}:\n\n\n${text}<end_of_turn>\n<start_of_turn>model\n`;
}

async function complete(src, lang, text) {
  let res;
  try {
    res = await fetch(`${LLAMA}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt(src, lang, text), n_predict: Math.min(1536, 64 + Math.round(text.length * 1.2)), temperature: 0, stop: ["<end_of_turn>"], cache_prompt: true }),
      signal: AbortSignal.timeout(600000),
    });
  } catch (e) { throw new ModelError(`server: ${e.message}`); }
  if (!res.ok) throw new ModelError(`server HTTP ${res.status}`);
  const d = await res.json();
  return String(d.content || "").trim();
}

const oneLine = async (src, lang, l) => (await complete(src, lang, l)).replace(/\s*\n\s*/g, " ").trim();

// "block": up to 8 lines per request; a chunk that comes back with the wrong
// number of lines is redone line by line. "lines": every line on its own.
async function translate(src, lang, lines, method) {
  const out = [];
  if (method === "lines") { for (const l of lines) out.push(await oneLine(src, lang, l)); return out; }
  for (let i = 0; i < lines.length; i += CHUNK) {
    const part = lines.slice(i, i + CHUNK);
    const got = (await complete(src, lang, part.join("\n"))).split("\n").map((l) => l.trim()).filter(Boolean);
    if (got.length === part.length) out.push(...got);
    else for (const l of part) out.push(await oneLine(src, lang, l));
  }
  return out;
}

async function serverUp() {
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(`${LLAMA}/health`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

const batch = JSON.parse(await readFile(args.in, "utf8"));
const items = batch.items || [];
const result = { batch: batch.batch, model: MODEL, stats: { items: items.length, done: 0, failed: 0, notReached: 0, modelError: null, seconds: 0, perItemSec: null, chars: 0 }, items: [] };
const t0 = Date.now();

if (items.length && !(await serverUp())) {
  result.stats.modelError = "model server did not start";
} else {
  let modelErrors = 0;
  for (const it of items) {
    if (result.stats.modelError || Date.now() - t0 > BUDGET_MS) { result.stats.notReached++; result.items.push({ key: it.key, out: null, error: null, notReached: true }); continue; }
    let out = null, error = null;
    try {
      out = await translate(it.src || "de", it.lang, it.lines, it.method || "block");
      modelErrors = 0;
      error = validate(it.lines, out, it.lang);
    } catch (e) {
      if (e instanceof ModelError) {
        if (++modelErrors >= 3) result.stats.modelError = e.message;
        result.stats.notReached++;
        result.items.push({ key: it.key, out: null, error: null, notReached: true });
        continue; // not the text's fault: reported as not reached, no attempt spent
      }
      error = e.message;
    }
    result.stats.chars += it.lines.join("\n").length;
    result.items.push({ key: it.key, out, error });
    if (error) result.stats.failed++; else result.stats.done++;
    if ((result.stats.done + result.stats.failed) % 5 === 0) log(`done ${result.stats.done}, failed ${result.stats.failed}, of ${items.length}`);
  }
}
result.stats.seconds = Math.round((Date.now() - t0) / 1000);
const n = result.stats.done + result.stats.failed;
result.stats.perItemSec = n ? +(result.stats.seconds / n).toFixed(1) : null;
await writeFile(args.out, JSON.stringify(result));
log("stats", JSON.stringify(result.stats));
