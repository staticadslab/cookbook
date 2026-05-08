# Reviews to persona image ads

Turn a CSV of customer reviews into Meta-ready image ads. This is a small developer starter (Express server + vanilla web UI) that wires customer reviews into the [Static Ads Lab](https://www.staticadslab.com) image-ad pipeline end-to-end.

## What it does

1. You upload a CSV of customer reviews.
2. It keeps the 4-star and 5-star ones.
3. Gemini reads them and suggests a handful of buyer personas.
4. You pick the personas you want ads for.
5. It generates one image ad per persona × design template, and shows you the PNGs to download.

## Run it

```bash
cd recipes/customer-reviews-to-persona-image-ads
npm install
cp .env.example .env
# Fill in the keys in .env and the IDs in src/config/recipe-constants.ts
npm start
```

Then open [http://localhost:9000](http://localhost:9000). The status banner at the top of the page tells you what (if anything) is still missing.

## What you'll need to set up

- **API keys** — see [`.env.example`](./.env.example) (Google Gemini + Static Ads Lab).
- **Static Ads Lab IDs** — brand, product, and design template IDs from your Static Ads Lab workspace, dropped into [`src/config/recipe-constants.ts`](./src/config/recipe-constants.ts).

## Going deeper

- The recipe's algorithm is documented at the top of [`src/main.ts`](./src/main.ts).
- AI coding agents (Cursor, Claude Code, Codex): start with [`prompt.md`](./prompt.md).
- Static Ads Lab API rules and behavior: [llms.txt](https://www.staticadslab.com/llms.txt) (the source of truth).
