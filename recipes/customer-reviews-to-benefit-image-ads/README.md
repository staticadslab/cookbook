# Reviews to benefit image ads

Turn customer reviews into a simple **benefit frequency chart**, then generate **flat Meta image ads** for the benefits you pick. This is a small Express server plus a plain web UI wired to Gemini and the [Static Ads Lab](https://www.staticadslab.com) async image-ad API.

## What it does

1. You upload a CSV of customer reviews.
2. It keeps 4-star and 5-star rows.
3. Gemini pulls short “signals” and verbatim snippets from each review, then groups them into benefit themes and counts how many reviews support each.
4. You see a bar chart of those counts and choose which benefits and design templates to use.
5. It generates one image ad per selected benefit × template. Each request sends a single **prompt** that combines the benefit theme and the best source review so Static Ads Lab can write on-template copy (no manual text-node injection in this recipe). You download PNGs from the gallery.

## Run it

```bash
cd recipes/customer-reviews-to-benefit-image-ads
npm install
cp .env.example .env
# Add keys to .env and fill ids in src/config/recipe-constants.ts (brand, product, audience, templates)
npm start
```

Then open [http://localhost:9001](http://localhost:9001). The strip at the top shows anything still missing.

## What you'll need to set up

- **Keys** — see [`.env.example`](./.env.example) (Gemini + Static Ads Lab).
- **Recipe constants** — [`src/config/recipe-constants.ts`](./src/config/recipe-constants.ts): brand, product, audience, design template ids, optional variant id. Forks start empty; fill from your workspace. The workspace card loads **names** from Static Ads Lab when your key and ids are valid, and the template picker loads **thumbnail images** the same way (you can still tick templates by id without previews if the key is missing).

## Going deeper

- Algorithm summary: [`src/main.ts`](./src/main.ts).
- Agent reading order: [`prompt.md`](./prompt.md).
- Platform rules: [llms.txt](https://www.staticadslab.com/llms.txt).
