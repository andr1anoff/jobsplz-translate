# translate

A small batch translator: German text in, English, Russian and Ukrainian out.
It runs [TranslateGemma](https://huggingface.co/google/translategemma-4b-it)
(4B or 12B, GGUF via [llama.cpp](https://github.com/ggml-org/llama.cpp)) on a
GitHub Actions runner and checks every result before returning it: same number
of lines, same numbers, the right script, no commentary from the model.

- `worker.mjs` — reads a batch file, translates, writes results
- `validate.mjs` — checks a translation
- `.github/workflows/translate.yml` — one runner per batch file, started by hand

TranslateGemma is subject to the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).
