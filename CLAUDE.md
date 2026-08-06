# CLAUDE.md

Reusable Next.js template — optimized for forking into new projects fast, not for building a specific product. Read this before making changes.

## Stack

- Next.js 15, App Router, TypeScript strict, `src/` directory
- Tailwind CSS v4 (CSS-first config — tokens live in `src/app/globals.css`, no `tailwind.config.ts`)
- shadcn/ui (Radix primitives, neutral base color, "Nova" preset) — `components.json` is the source of truth
- Supabase via `@supabase/ssr` — separate browser/server clients, typed against `src/types/supabase.ts`
- pnpm — always use `pnpm`, never `npm`/`yarn`
- ESLint (flat config, `next/core-web-vitals` + `next/typescript` + `import/order`) + Prettier (`prettier-plugin-tailwindcss`)
- Husky + lint-staged on pre-commit
- Vitest + React Testing Library for tests
- Docker (multi-stage, `output: 'standalone'`) targeting Coolify

## Conventions

- Files: kebab-case (`todo-list.tsx`). Components: PascalCase (`TodoList`).
- `src/components/ui/**` is shadcn-managed and **presentational only** — no business logic, no Supabase imports, no server actions. Add/update primitives via `pnpm dlx shadcn@latest add <name>`, don't hand-edit generated files beyond trivial fixes.
- `src/components/[feature]/**` composes `components/ui` primitives into feature UI. May import and call server actions (prop-wiring); may not write new Supabase queries.
- `src/lib/actions/**` returns a boolean-tagged result: `{ ok: true; data: T } | { ok: false; error: string }`. Prefer this over nullable-field unions — they don't narrow cleanly through destructuring under `strict` mode (see `src/lib/actions/todos.ts`).
- New Supabase tables: add a migration under `supabase/migrations/`, enable RLS with explicit policies, and update `src/types/supabase.ts`.

## The gate

Before considering any change done, all of these must be clean:

```
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
```

- No `@ts-ignore` / `@ts-expect-error` / `as any` to silence a type error — fix the type.
- No weakened or skipped tests to make the suite pass.
- `pnpm lint` and `pnpm format:check` must both report clean (Prettier owns style, ESLint owns correctness — don't fight the formatter with manual style rules).

## Agent routing

Subagents in `.claude/agents/` are scoped by verb, not role. Route work by file path:

| Path | Owner | Notes |
| --- | --- | --- |
| `src/components/[feature]/**` | `build-ui` | Composes `components/ui`, owns Tailwind/layout/responsiveness |
| `src/app/**/*.tsx` (layout/JSX/styling) | `build-ui` | Data fetching in Server Components should call `lib/actions/**`, not query Supabase inline |
| `src/components/ui/**` | shadcn CLI | Not hand-owned by either agent — regenerate via CLI |
| `src/lib/supabase/**` | `implement-logic` | Browser/server clients, middleware session refresh |
| `src/lib/actions/**` | `implement-logic` | Server actions — queries, mutations, revalidation |
| `src/lib/validations/**` | `implement-logic` | zod schemas |
| `src/app/api/**` | `implement-logic` | Route handlers |
| `src/types/**` | `implement-logic` | Database types |
| Anything, read-only | `code-reviewer` | Run after each milestone, before commit. Never edits. |
| Anything, gate enforcement | `test-runner` | Proactively after any code change. Fixes root causes, never weakens tests. |

When a task spans both UI and logic (e.g. "add a demo CRUD flow"), split it: `implement-logic` writes the schema/action/route first, `build-ui` wires the component to it second.

## Local dev

```
pnpm install
cp .env.example .env.local   # fill in a real Supabase project to exercise /todos
pnpm dev
```

Without Supabase configured, the app still starts and `/` and `/api/health` work — the health route always returns 200 with a diagnostic `supabase: "connected" | "unreachable"` field. `/todos` will show a graceful inline error until real credentials are set.
