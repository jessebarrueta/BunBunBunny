# Engineering Charter

This file is law. Read it every session. When in doubt, it wins over convenience.

## Project

A vertical-scroll social feed where every post is a drop-in multiplayer browser game,
with a persistent traveling character. The design spec in `spec/` is the source of truth
for *what* to build; this charter governs *how*.

## Stack

- **Vite + TypeScript (strict)** — the app shell and build.
- **three.js** — the WebGL layer (rendering, character, the leap/transition).
- **Native HTML/CSS** — the scroll feed itself. Do NOT rebuild the feed in a framework;
  native scroll is a deliberate architectural choice (spec §3.3). WebGL mounts only on
  the focused card.
- **Vitest** — tests. **ESLint** — enforcement.

No other runtime framework (no React/Vue/etc.) unless the spec or I explicitly call for it.

## Architecture: functional core, imperative shell

This is the organizing principle. Obey it.

- **Pure core** — all logic as pure functions over plain data: recipe validation, relic
  interpretation, snapshot encode/decode and delta computation, interpolation math,
  feed ranking. No classes holding state, no hidden mutation, no I/O. Given the same
  input, same output. These are the parts that get tested.
- **Effectful shell** — push all side effects to the edges: WebGL/three.js, the network
  transport, the Rapier sim loop, the DOM, storage. Thin, boring, glue.
- A function that both computes *and* touches the world is a smell. Split it.

## Code standards

- **Immutability by default.** No mutation of inputs, no reassignment without reason.
  Prefer `readonly`, `const`, and returning new values. Mutation is a local optimization
  you justify, not a default you reach for. (ESLint enforces; don't fight it, fix it.)
- **Make illegal states unrepresentable.** Lean on the type system. Prefer discriminated
  unions and narrow types over booleans-and-checks. `any` is banned without a one-line
  justification comment; `unknown` + narrowing is almost always the right move.
- **Small, single-purpose, well-named.** Name functions for what they return, not how.
  If a function needs "and" to describe it, split it.
- **Comments explain *why*, never *what*.** The code says what. Comments justify
  non-obvious decisions. No narration.
- **Mark deliberate shortcuts with a `ponytail:` comment** naming the ceiling and the
  upgrade path, e.g. `// ponytail: naive O(n) scan, index it if the catalogue grows`.
  These are the code-level twin of the spec's open-decisions ledger. Don't bury debt
  silently; name it so it's harvestable later.
- **Tests for load-bearing logic.** Every non-trivial pure function in the core ships
  with a Vitest test — especially anything touching money-equivalents (relics), security,
  or the netcode wire format. Trivial one-liners don't need tests; YAGNI applies to tests too.

## Dependencies — firm but pragmatic

The platform is the first dependency. Reach in this order: **Web platform / standard
library → a small local module → a dependency.** A new runtime dependency needs a
one-line justification in the commit message stating why the platform can't do it.
No dependency for something `Intl`, `fetch`, `structuredClone`, a `<input type=...>`,
or twenty lines of local code already handles. Dev dependencies (lint, test, build)
are freer. The ponytail skill is installed and active to backstop this — heed it.

## How to work (procedural)

- **Plan before non-trivial work.** State the approach in a few lines and, for anything
  architectural or multi-file, wait for a nod before writing. No surprise 800-line diffs.
- **Small, reviewable changes.** One coherent thing at a time.
- **Never silently** change architecture, add a dependency, or deviate from the spec.
  Surface it and let me decide.
- **"Done" means green, and you ran it.** A task is not complete until `tsc --noEmit`,
  `eslint`, and `vitest` all pass — and you ran them yourself and saw them pass. Never
  report done on unverified code.
- **Don't invent APIs.** Especially three.js/WebGL — version drift is real. If unsure a
  method or signature exists, check it or say you're unsure. A confident wrong API call
  is worse than a question.
- **Surface conflicts, don't paper over them.** If the spec and the easy path disagree,
  say so. If the spec is ambiguous or looks wrong, raise it — don't guess and don't
  quietly "fix" it.
- **Push back when I'm wrong**, with reasoning. I want a colleague, not a yes-man. A
  disagreement stated once and clearly is worth more than silent compliance.
- **Cite the spec section** you're implementing in the commit or PR description.

## Spec is law

`spec/` is authoritative for product and architecture decisions. Implement to it, cite it,
and when reality diverges from it, update the spec in the same change rather than letting
code and spec drift. The spec was kept honest on purpose; keep it that way.