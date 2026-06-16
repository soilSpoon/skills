// The per-leaf test-discipline prompt fragment — a DYNAMIC builder, separated from the static R_* personas
// (prompts.ts) and from the orchestrator. Closes over only the baseline's measure command.
export const makeLeafTest = (measureCommand: string) => (scope?: string): string =>
  `\nLEAF TEST DISCIPLINE (measured #1 time cost): at THIS leaf run ONLY the FILTERED tests — the bare full ` +
  `measure command (\`${measureCommand}\`) is FORBIDDEN here (it recompiles + runs the whole unrelated ` +
  `suite; it runs ONCE at integration as the net). ` +
  (scope ? `Test scope = \`${scope}\` — run the project-card filter form scoped to it, and NAME the test you add so this EXACT token matches the runner's filter. Know your runner: many match a FUNCTION/TEST-NAME substring (Swift Testing \`--filter\`, pytest \`-k\`) — for those put \`${scope}\` IN the @Test/test-function name, NOT a suite path; suite-path runners match the suite/class name. (The engine re-runs this filter as the deterministic gate; a name mismatch = zero tests matched, which now degrades THIS leaf to LLM-verify — a FINDING, not a false RED.) `
         : `Filter to the test you add or touch — match the runner's filter syntax (function-name substring for Swift Testing/pytest; suite path otherwise). `) +
  `A full BUILD is fine; a full TEST run is not. STATIC CHECKS (lint/typecheck) follow the same rule: scope them to ` +
  `the files you changed when the toolchain supports it (e.g. lint only changed paths; rely on the typechecker's ` +
  `incremental cache) — a WHOLE-PROJECT lint/typecheck belongs to the integration net, not to every edit. ` +
  `Minimize re-runs: red once, green once, post-refactor once — do not re-run an unchanged check. ` +
  `Never poll or busy-wait on other processes (no pgrep/sleep loops — one such loop once wasted 5 minutes); run your command directly and let the build tool's own lock serialize. ` +
  `REPORT \`testScope\` in your result: the SINGLE bare token (a suite name, or a shared substring of the test names you added — matching /^[A-Za-z0-9_.-]+$/; NO spaces/slashes/'|') under which the project-card filter form runs EXACTLY the test(s) you added/touched and nothing unrelated. The engine re-runs that filter as the deterministic per-leaf gate — so it MUST match the names you actually used (a wrong token zero-matches → this leaf degrades to LLM-verify, never a false RED). This is what binds the deterministic gate when no scope was handed to you above; without it the leaf rests on the LLM verifier alone.`
