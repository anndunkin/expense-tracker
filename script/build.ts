import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm } from "node:fs/promises";

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  // Bundle ALL dependencies into a single file.
  // Only better-sqlite3 is excluded because it contains a native .node binary
  // that must remain as a separate file on disk.
  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    // Only the raw .node binary can't be bundled — everything else including
    // the better-sqlite3 JS wrapper gets inlined into the single output file.
    external: ["*.node"],
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
