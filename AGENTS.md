# Agent instructions (cookbook)

This repo is one of the Static Ads Lab product repos. Shared durable knowledge lives in
the **LLMWiki** repo, not here.

## Before you start

1. Pull the wiki and read the index: `git -C ../llm-wiki pull --rebase` then read
   `../llm-wiki/wiki/index.md` and the page for this repo
   (`../llm-wiki/wiki/products/cookbook.md`).
2. Check the tracker: `../llm-wiki/scripts/gh-sal issue list -R staticadslab/cookbook --state open`.
   Read the issue you are working from and confirm it still matches the code and wiki.
   See `../llm-wiki/schema/ISSUES.md`.

## While you work

- Keep changes scoped to the issue.
- **Keep the tracker aligned as work happens**: comment status, decisions, blockers, and
  scope changes on the issue. If you find work not covered by an issue, open one (use the
  templates). If an issue is stale or wrong, update or close it with a note. Add `agent`
  while you own it, `blocked` when stuck, `needs-review` when done.
- Follow this repo's existing conventions and any tool-specific rules
  (`.cursor/rules/`, `CLAUDE.md`).

## Main doc — HARD RULE

The review doc `1U3u6uwnP8wNE_agoUpGdryV8p0cA911bSlq3n2WKeeU` is human-only. Never edit
it directly; submit flagged comments only. See `../llm-wiki/schema/MAIN_DOC.md`.

## Before you finish

1. Update or close the GitHub issue (`../llm-wiki/scripts/gh-sal issue comment ...`).
2. If you produced durable knowledge (architecture, decisions, gotchas), write it into
   the wiki, not into this repo's docs — follow `../llm-wiki/schema/AGENTS.md`.
3. Push the wiki so the next session starts aligned.

Full rules: [`../llm-wiki/schema/AGENTS.md`](../llm-wiki/schema/AGENTS.md).