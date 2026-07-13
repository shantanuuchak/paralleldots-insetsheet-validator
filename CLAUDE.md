# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

Package manager is Bun (`bun.lock` present); npm works too since there's no bun-specific config.

```bash
bun install       # install deps (node_modules is not checked in / not currently installed)
bun run dev       # start dev server at http://localhost:3000
bun run build     # production build
bun run start     # serve production build
bun run lint      # next lint (flat config via eslint.config.mjs, next/core-web-vitals + next/typescript)
```

There is no test suite/framework configured in this repo (no test script, no test files).

## Architecture

This is a single-page Next.js (App Router) client app. Almost all logic lives in two files:

- `src/lib/validator.ts` — pure CSV validation engine. `validateCSV(file)` parses a CSV with PapaParse (`header: true`, `skipEmptyLines: false` so reported row numbers match file line numbers) and runs rules against each row, returning a `ValidationSummary`. Column lookup is fuzzy/case-insensitive via `findValue()`, which normalizes header names (trim, lowercase, strip spaces/underscores/dashes) and matches against `FIELD_ALIASES` (e.g. `patch_count`/`patchCount`/`patch`). This is the place to add/modify validation rules. There are two rule *kinds*:
  - **Per-row rules** (Status, Patch Count Consistency, Group Deletion Lock, Group Name Cleanliness) — pushed inside the row loop via the local `addIssue()` helper, which also tracks `errorRowSet` for distinct-row metrics.
  - **Sheet-level rules** (currently "Required Others Group") — evaluated *after* the loop. A group_name *containing* the word `Others` (bare `"Others"` or appended like `"Fruit Juice - Others"`) satisfies it. When **absent**, an error is emitted with `row: 0` / `insetId: "— Sheet-wide —"` (dashboard renders `row === 0` as `SHEET`). When **present**, no issue is raised — instead every matching row is collected into `summary.othersMatches` (`{row, value, exact}`) and rendered as a *positive* green panel above the issues table (a match must not appear as an "issue"). `ValidationSummary` also exposes `errorRows`/`passingRows`/`healthPct` (never negative; `errorCount` counts *issues*, which can exceed row count, so UI metrics use these row-based fields instead).
- `src/components/ValidatorDashboard.tsx` — the entire UI: dropzone upload, metrics dashboard, filterable/paginated/searchable issue table, row selection, CSV export (`exportSelected` uses the `csvCell` RFC-4180 escaper + a UTF-8 BOM), and a slide-in rules-reference drawer. `VALIDATION_RULES` and the `ruleCounts`/filter-chip strings in this file are a *human-readable mirror* of the rules and must be kept in sync manually with `validator.ts` — they are not derived from each other. When adding a rule, update: the `validator.ts` logic, `VALIDATION_RULES`, `ruleCounts`, and the filter-chip block.
- The app uses `@heroui/react`'s `HeroUIProvider` (wired in `src/app/providers.tsx`) for theming context, but UI components are NOT built with HeroUI — there's a hand-rolled `Button` component at the top of `ValidatorDashboard.tsx` with a comment noting it exists "to avoid heroui typing compilation bugs." Don't reach for HeroUI components; extend the custom `Button` or plain elements instead.
- Styling is Tailwind v4 (`@theme` in `src/app/globals.css`) using a fixed set of semantic CSS variables (`--color-background`, `--color-surface`, `--color-primary`, `--color-error-main`, etc.) rather than Tailwind's default palette. Use these existing tokens (`bg-surface`, `text-error-main`, `bg-error-container`, ...) rather than introducing raw Tailwind colors.
- No backend/API routes, no database, no auth — everything (parsing, validation, export) runs client-side in the browser. `exportSelected()` in the dashboard builds and downloads a CSV via a Blob URL, entirely in-memory.

### Important note on Next.js version

`AGENTS.md` (imported above) asserts this Next.js install has non-standard breaking changes and docs live under `node_modules/next/dist/docs/`. `node_modules` is not currently installed, and real Next.js releases do not ship a `docs/` folder in `dist/`. Treat that claim with suspicion — after `bun install`, verify whether `node_modules/next/dist/docs/` actually exists before trusting it; if it doesn't, this project's Next.js behaves like standard Next.js 15 (App Router, `next.config.ts`, etc.) and that AGENTS.md line is stale or inaccurate.
