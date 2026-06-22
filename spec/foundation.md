# Foundation — codebase setup & first build

Companion to the architecture spec. The spec says *what*; the charter (`AGENTS.md`, repo
root) says *how*; this says *how the code is laid out and where to start*.

## Stack

- **Vite + TypeScript (strict)** — shell and build.
- **three.js** — WebGL: character, world rendering, the leap/transition.
- **Native HTML/CSS** — the scroll feed. Deliberately *not* a framework (spec §3.3); native
  scroll must feel as good as TikTok and that's free from the platform. WebGL mounts only on
  the focused card.
- **Vitest** — tests. **ESLint** (+ FP/immutability rules) — enforcement.
- Server (later): authoritative headless Rapier room, Colyseus-class transport (spec §8).

Keep the dependency tree thin (charter: firm-but-pragmatic). The ponytail skill is installed
and active as the anti-over-engineering backstop.

## Repo layout (functional core / imperative shell)

The folder structure *is* the architecture (spec §3, charter). Pure logic and effects don't mix.

```
/
  AGENTS.md                 # engineering charter — law, read every session
  spec/                     # architecture.md, screenflow.md, foundation.md (this) — source of truth
  assets/
    bunnyboy-animated.glb    # first real character: rigged, textured, 5 clips
  src/
    core/                   # PURE. no I/O, no three.js, no DOM. fully unit-tested.
      recipe/               #   recipe schema, validation, blessed-set sampling (spec §4)
      relic/                #   relic interface + per-world interpretation (spec §6.1)
      net/                  #   snapshot encode/decode, delta, interpolation math (spec §8.1)
      feed/                 #   ranking / liveness logic (spec §5)
    shell/                  # EFFECTFUL. thin glue around the core.
      render/               #   three.js: scene, character, AnimationMixer, the leap
      feed-ui/              #   native HTML/CSS feed, card states, soft-modal (spec §9)
      transport/            #   websocket / WebTransport client (spec §8.7)
      sim/                  #   Rapier loop binding (client + later server)
    main.ts                 # compose root: wire shell to core
  tests/                    # mirrors src/core
```

Rule of thumb: if a file imports `three`, the DOM, or the network, it lives in `shell/`.
If it's a pure data transform, it lives in `core/` and has a test.

## Tooling lineup

- **Claude Code** — primary builder. Reads `CLAUDE.md` + `spec/` every session.
- **ponytail** (installed skill) — always-on minimalism gate. Install:
  `/plugin marketplace add DietrichGebert/ponytail` → `/plugin install ponytail@ponytail`.
- **Codex** — second opinion / adversarial review of bounded pieces, not primary authoring.
- **GPT-image** — art-direction reference only (look, character, key-art), never screen structure.
- (No Figma — everything lives in code, one source of truth.)

## "Done means green"

A task is complete only when all three pass and the agent ran them:

```
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest
```

Wire these as scripts in `package.json` from day one so "done" is verifiable, not asserted.

## First build — the walking skeleton (= spec ledger #18)

The smallest real, running slice that de-risks the whole architecture. This is also the
HTML→WebGL handoff prototype the spec has been pointing at — the foundation and the next
open risk are the same task.

**Scope (and nothing more):**
1. A native HTML vertical-scroll feed of a few placeholder cards (spec §9 soft-modal: tap = act,
   swipe-up = exit).
2. A single persistent full-viewport three.js context renders the companion over the
   native feed and becomes the focused game's WebGL layer on commit (spec §9.2). The
   canvas never shrinks around the character; camera/model framing controls apparent size.
3. `assets/bunnyboy-rigged.glb` loads and plays `idle` at roughly one-third viewport
   height in the lower-left; it is one traveling character, never replicated per card.
4. Tap first eases the character through a 90-degree turn toward the card; once the turn
   completes, the card's full-frame push-in and the character's `leap` animation start
   together. The leap targets card center; 250 ms after it begins, the character starts
   shrinking to roughly one-fifth viewport height. A white fade covers the animation-to-idle
   reset, then reveals the character centered in the viewport. The WebGL layer takes over
   for the transition (spec §3.3), then returns to the feed on swipe-up or close.

**What it proves:** that the HTML→WebGL handoff is seamless (or reveals it isn't), on a real
phone, with the real character. If the handoff is clean, the hybrid-rendering architecture is
confirmed and everything else builds on it. If it's janky, that's decisive early signal.

**Explicitly out of scope for the skeleton:** multiplayer, the server, relics, real recipes,
authoring, the companion, monetization. Resist all of it — the skeleton's only job is the
feed-card-leap loop with one real character.

## Build order after the skeleton

Per the spec, the one real wall is **snapshot transport at high awake-body counts** (§8.7,
ledger #15) — delta encoding + awake-island culling over a real transport. Render and server
CPU are already known-safe (§8.6). So after the skeleton: stand up the authoritative room and
the transport, because that's the only architecturally-unproven piece. Everything else is
known-quantity assembly on top of a validated foundation.
