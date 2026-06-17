# Claude Agent SDK host for the recursive-slice engine (PR4)

The **third Runtime adapter** (after the Claude Code Workflow runtime and the opencode adapter). It runs
the engine artifact in a **real Node process**, which fixes the single biggest cost of the Workflow path:

- **Native `sh()`** — the engine's deterministic shell proxy runs via `execFile("/bin/sh", …)`, NOT as a
  haiku subagent. On the Claude Code Workflow runtime the sandbox has no `exec()` (probe-confirmed:
  `require`/`process`/`import` all blocked), so *every* git/test/build is a full subagent round-trip
  (~75% of all agent spawns in a measured run). Here that tax is **zero**.
- **`agent()` → Agent SDK `query()`** with native structured output (`outputFormat: {type:'json_schema'}`),
  mapped to PR2's `AgentOutcome` kinds (`schema`/`quota`/`model_unavailable`/`timeout`/`refusal`/`null`).
- **Real budget** from `total_cost_usd`; **role routing** → persona (`agents/slice-<role>.md`) + tool set.

Isolated package: own `package.json`/`tsconfig.json`/`node_modules` — zero deps leak into the core.

## Run

```sh
node run.mjs --repo /path/to/repo --task "…" [--parallel] [--max-depth N] [--skills a.md,b.md]
```

## Auth / billing (Max plan)

Uses your Claude login (`claude setup-token`, or the subscription OAuth). The announced 2026-06-15
"Agent SDK → separate credit pool" change is **PAUSED / not in effect**, so Agent SDK usage currently
draws on the **Max subscription** (verify in Settings>Usage). **Do NOT set `ANTHROPIC_API_KEY`** unless
you intend pay-as-you-go API billing — it takes precedence over the subscription (known Claude Code gotcha).

## Status

- ✅ `tsc --noEmit` clean against the real `@anthropic-ai/claude-agent-sdk@0.3` types.
- ✅ `npm test` — 13 deterministic unit tests (native sh, `AgentOutcome` mapping, role routing, mocked
  `query()`); **no tokens spent**.
- ⏳ **Live end-to-end** (a real slice lane via the SDK) is the next validation — it spends tokens, so it
  is owner-run, not part of `npm test`. A `--task` run against a real repo exercises the full path.

## Known follow-ups (documented, not silent)

- `agent()` returns `value | null` (the Runtime.agent contract; `host.ts` `agentSafe` re-classifies). A
  typed-quota throw so `QUOTA_HALT` fires on `kind:'quota'` (vs the generic null-streak) is a follow-up.
- Persona/tool sets are a sensible default per role; tuning them (e.g. heavy-lens cross-model diversity)
  is open.
- `permissionMode: "bypassPermissions"` for non-interactive runs — the engine only edits inside the repo.
