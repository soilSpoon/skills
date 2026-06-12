// Builds the single self-contained artifact the Workflow runtime executes.
//
// banner: the runtime statically requires `export const meta = {pure literal}`
//   as the very first statement — a bundler relocates in-module exports, so the
//   meta block is injected as raw text here (its ONLY home).
// footer: injects the top-level `return await __main()` the runtime needs
//   (invalid in a TS module, valid in the runtime's async-function context).
// treeShaking OFF: __main is only referenced from the footer, which esbuild
//   cannot see — shaking would delete the whole engine.
// (No `import from 'tsup'` — the config must load via npx without node_modules.)

const META = `export const meta = {
  name: 'recursive-slice',
  description: 'Trust-first recursive decomposition: baseline → plan → recursive slice/execute with Canon-TDD discipline, risk-tiered adversarial verification, self-repair, per-leaf git commits → (opt-in) parallel worktree groups + coordinator merge → integrate. Generic over any repo+task via args.',
  phases: [
    { title: 'Baseline', detail: 'capture the invariant + project card to preserve' },
    { title: 'Plan', detail: 'classify root; (parallel mode) slice into independent groups' },
    { title: 'Work', detail: 'recursive slice/execute with discover-as-you-go (Canon TDD); parallel worktrees if independent' },
    { title: 'Coordinate', detail: 'merge parallel worktree branches, resolve conflicts (parallel mode only)' },
    { title: 'Integrate', detail: 'final adversarial check of the whole vs baseline' },
  ],
}`

export default {
  entry: { 'recursive-slice': 'src/main.ts' },
  format: ['esm'],
  target: 'es2022',
  outDir: 'build',
  splitting: false,
  clean: true,
  banner: { js: META },
  footer: { js: 'return await __main()' },
  esbuildOptions(options: { treeShaking?: boolean; charset?: string }) {
    options.treeShaking = false
    options.charset = 'utf8'
  },
}
