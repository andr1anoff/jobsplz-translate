// Checks on a machine translation. Returns null when
// the output passes, otherwise a short reason that goes into the queue.

const LETTERS = /[A-Za-zÄÖÜäöüßА-Яа-яЁёІіЇїЄєҐґ]/g;
const CYR = /[А-Яа-яЁёІіЇїЄєҐґ]/g;
const count = (s, rx) => (s.match(rx) || []).length;
const numbers = (s) => (s.match(/\d+/g) || []).map((n) => String(parseInt(n, 10))).sort();
const CHATTER = /^(here is|here's|translation|sure[,!]|certainly|вот перевод|перевод:|ось переклад|переклад:)/i;
const GERMAN_WORDS = /\b(und|der|die|das|mit|für|im|zur|zum|bei|oder|nach|wir|sie|ihre|deine)\b/gi;

// Lines that may legitimately come back unchanged: contacts, links, codes,
// names, or anything with too few ordinary words to translate.
const KEEP = /@|https?:\/\/|www\.|\+?\d[\d\s/()-]{6,}\d/;
function keepAsIs(s) {
  if (KEEP.test(s)) return true;
  const words = s.replace(/[^A-Za-zÄÖÜäöüß\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  return words.length <= 3;
}

export function validate(src, out, lang, { mock = false } = {}) {
  if (!Array.isArray(out) || out.length !== src.length) return `lines: expected ${src.length}, got ${out?.length ?? 0}`;
  for (let i = 0; i < src.length; i++) {
    const s = src[i], o = out[i];
    if (!o) return `line ${i + 1} empty`;
    if (CHATTER.test(o)) return `line ${i + 1} has commentary`;
    const a = numbers(s).join(","), b = numbers(o).join(",");
    if (a !== b) return `line ${i + 1} numbers differ: [${a}] vs [${b}]`;
    if (!mock && o === s && !keepAsIs(s)) return `line ${i + 1} left untranslated`;
  }
  const S = src.join(" "), O = out.join(" ");
  const ratio = O.length / Math.max(1, S.length);
  if (!mock && (ratio < 0.4 || ratio > 3)) return `length ratio ${ratio.toFixed(2)}`;
  if (mock) return null;
  if (lang === "ru" || lang === "uk") {
    const share = count(O, CYR) / Math.max(1, count(O, LETTERS));
    if (share < 0.6) return `cyrillic share ${share.toFixed(2)}`;
    if (lang === "ru" && /[іїєґІЇЄҐ]/.test(O)) return "Ukrainian letters in Russian";
    if (lang === "uk" && /[ыэъЫЭЪ]/.test(O)) return "Russian letters in Ukrainian";
  }
  if (lang === "en") {
    if (/[äöüß]/i.test(O.replace(/\b[A-ZÄÖÜ][\wäöüß-]*\b/g, ""))) return "German letters in English";
    if (count(O, GERMAN_WORDS) >= 2) return "German words left in English";
  }
  return null;
}
