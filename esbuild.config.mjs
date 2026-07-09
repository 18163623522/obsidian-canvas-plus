import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

// Node 内置模块（硬编码，避免再引 builtin-modules 包）
const builtins = [
  "assert", "child_process", "cluster", "crypto", "dgram", "diagnostics_channel",
  "dns", "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring", "readline",
  "repl", "stream", "string_decoder", "sys", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
];

const pluginDir = "D:/001_Archive/文档/Note/Note/.obsidian/plugins/canvas-plus";

const context = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: `${pluginDir}/main.js`,
};

// 复制 manifest.json / styles.css 到目标 vault（开发便利）
async function copyStatic() {
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.copyFile("manifest.json", path.join(pluginDir, "manifest.json")).catch(() => {});
  await fs.copyFile("styles.css", path.join(pluginDir, "styles.css")).catch(() => {});
}

await copyStatic();

if (prod) {
  await esbuild.build(context);
} else {
  const ctx = await esbuild.context(context);
  await ctx.watch();
  console.log(`[canvas-plus] watching → ${pluginDir}/main.js`);
  // 复制 manifest/styles 一次即可；后续热构建只重写 main.js
}
