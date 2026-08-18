# frontend/vendor/

`supabase-js.mjs` is a self-contained ESM bundle of `@supabase/supabase-js` (built with esbuild
from the `@supabase/supabase-js` version installed in `node_modules`, bundling its own
`@supabase/*` sub-dependencies so the browser never needs a bare-specifier resolver).

Checked in instead of imported at runtime from a CDN (previously `esm.sh`): a real staging test
(SW-040) found that when `esm.sh` was unreachable from a visitor's network, `frontend/auth-gate.js`
failed to load it and the entire login gate died silently — no overlay, no error, just the raw demo
dashboard shown unfiltered. Vendoring removes that runtime dependency for both local use
(`frontend/index.html` opened directly) and any hosted deploy.

## Regenerating

```
npm install --no-save esbuild
npx esbuild --bundle --format=esm --platform=browser --minify \
  --outfile=frontend/vendor/supabase-js.mjs \
  node_modules/@supabase/supabase-js/dist/index.mjs
npm uninstall --no-save esbuild
```

Re-run this after bumping the `@supabase/supabase-js` version in `package.json`.
