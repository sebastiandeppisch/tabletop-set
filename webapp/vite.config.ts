import { defineConfig } from "vite";

// GitHub Pages serves a project site under /<repo>/, not /. Only applied
// when the deploy workflow sets GITHUB_PAGES, so local dev/build (and the
// e2e smoke scripts, which hit http://localhost:.../ directly) are unaffected.
const base = process.env.GITHUB_PAGES ? "/tabletop-set/" : "/";

export default defineConfig({
  base,
  test: {
    testTimeout: 20000,
  },
});
