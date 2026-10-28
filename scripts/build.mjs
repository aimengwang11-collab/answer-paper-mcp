/**
 * Build adapted from excalidraw-mcp `scripts/build.mjs` (MIT).
 * That script typechecks, emits a single HTML widget, then bundles the server.
 * This copy uses esbuild instead of Vite + Bun, and does not bundle Excalidraw.
 */
import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");

function run(command) {
  console.log(`> ${command}`);
  execSync(command, { cwd: root, stdio: "inherit" });
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

run("tsc -p tsconfig.json --noEmit");

const bundled = await esbuild.build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "src/mcp-app.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = bundled.outputFiles[0]?.text;
if (!js) throw new Error("Widget bundle was empty.");

const template = fs.readFileSync(path.join(root, "src/mcp-app.html"), "utf8");
const html = template.replace(
  '<script type="module" src="./mcp-app.ts"></script>',
  () => `<script type="module">\n${js}\n</script>`,
);
if (html === template) throw new Error("mcp-app.html is missing the module script tag.");
fs.writeFileSync(path.join(distDir, "mcp-app.html"), html);

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "src/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: path.join(distDir, "index.js"),
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
});
