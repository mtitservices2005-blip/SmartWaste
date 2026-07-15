# Operations adapter

`shared/operations-adapter.js` exposes backend-shaped operations for vehicles, routes, assignments, progress, verification, positions, and incidents. Current execution is `DEMO_ONLY`/`READY` because no real backend endpoint or RPC has been verified. The map can consume `listPositions()` instead of coupling directly to `shared/demo-data.js`.
