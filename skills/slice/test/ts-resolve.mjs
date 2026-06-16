// Node module-customization resolve hook for unit tests: the engine's src/*.ts use bundler-style
// extensionless relative imports (`from './util'`); Node's native ESM resolver needs an extension.
// Append `.ts` for relative specifiers that lack a JS/TS extension so the modules load directly.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[mc]?[jt]s$/.test(specifier)) {
    try { return await nextResolve(specifier + '.ts', context) } catch { /* fall through to default */ }
  }
  return nextResolve(specifier, context)
}
