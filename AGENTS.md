# Agent instructions (cookbook)

This repo is one of the Static Ads Lab product repos. Shared durable knowledge lives in
the **LLMWiki** repo, not here.

## Before you start

1. Pull the wiki and read the index: `git -C ../llm-wiki pull --rebase` then read
   `../llm-wiki/wiki/index.md` and the page for this repo
   (`../llm-wiki/wiki/products/cookbook.md`).
2. Read the GitHub issue you are working from (see `../llm-wiki/schema/ISSUES.md`).
   Use the org account for issue operations: `../llm-wiki/scripts/gh-sal`.

## While you work

- Keep changes scoped to the issue.
- Follow this repo's existing conventions and any tool-specific rules
  (`.cursor/rules/`, `CLAUDE.md`).

## Before you finish

1. Update or close the GitHub issue (`../llm-wiki/scripts/gh-sal issue comment ...`).
2. If you produced durable knowledge (architecture, decisions, gotchas), write it into
   the wiki, not into this repo's docs — follow `../llm-wiki/schema/AGENTS.md`.
3. Push the wiki so the next session starts aligned.

Full rules: [`../llm-wiki/schema/AGENTS.md`](../llm-wiki/schema/AGENTS.md).
