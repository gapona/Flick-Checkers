// Node's native TS type-stripping (used by verify:* scripts) resolves ESM specifiers
// exactly like plain Node — it does not probe extensionless relative imports the way
// Vite/tsc (moduleResolution: "bundler") do, so `./scrollMomentum` fails to resolve even
// though the file is `scrollMomentum.ts`. This hook is a minimal, source-file-preserving
// fix: retry an extensionless specifier with `.ts` appended before giving up, so
// `src/**/*.ts` files can keep the same import style as the rest of the codebase instead of
// special-casing verification scripts.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw err
  }
}
