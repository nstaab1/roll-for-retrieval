# Roll for Retrieval

The workshop repo for Roll for Retrieval. You build a question-answering pipeline over transcripts of two real D&D campaigns, one act at a time, from a codespace. The guide is in `guide/`, and it starts at `guide/act-0.html`.

## Before the workshop

Three steps, about fifteen minutes. Do them by the night before. On a work laptop, do them before you leave home. If the laptop blocks Codespaces, you'll need to bring a different one.

1. **A personal GitHub account.** Work accounts often can't create codespaces. The day uses 16 of the 120 free core-hours a personal account gets each month.
2. **A hosted model key.** Make an OpenRouter key and put $5 to $10 of credit on it. An OpenAI key works too, for every stage but one optional swap.
3. **Open the codespace and run the doctor.** In Chrome or Edge, open [codespaces.new/nstaab1/roll-for-retrieval](https://codespaces.new/nstaab1/roll-for-retrieval) and create the codespace. It takes about two minutes. In its terminal, copy the example env file:

   ```bash
   cp .env.example .env
   ```

   Paste your key after `OPENROUTER_API_KEY=` in `.env`, or after `OPENAI_API_KEY=` for an OpenAI key. Then run the doctor:

   ```bash
   npm run doctor
   ```

   You're done when it prints READY. A line marked ✗ ends with the fix. Close the tab afterwards. The codespace stops on its own and keeps your `.env` for the day.

Optional: to run the same container on your own machine with Docker and VS Code's Dev Containers extension, pull the image ahead of time:

```bash
docker pull ghcr.io/nstaab1/roll-for-retrieval:2026-11-23
```

Ollama serves an OpenAI-compatible API, so you can point a provider's `baseURL` in `src/config.ts` at it and run the models on your own machine. The workshop doesn't test that path.

## Licence

The code is MIT, in [LICENSE](LICENSE). The clips, transcripts and documents are game content from two real tables, shared with the players' permission. They're not under the code licence.
