// Root Vitest config so `vitest run` / `npm test` auto-discovers the strict
// 95% coverage thresholds. The real configuration lives in configs/vitest.config.ts;
// vitest only auto-loads a config from the repo root, not from configs/.
export { default } from "./configs/vitest.config.js";
