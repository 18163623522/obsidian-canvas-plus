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

// 构建产物同步到所有使用中的 vault（第一个为主输出，其余复制）。
// 含两台开发机器的路径；本机不存在的路径会被自动创建为空目录（无害）。
const pluginDirs = [
  "D:/001_Archive/文档/Note/Note/.obsidian/plugins/canvas-plus",
  "D:/001_Archive/文档/Note/Obsidian/笔记整理/.obsidian/plugins/canvas-plus",
  "D:/Note/Obsidian/.obsidian/plugins/canvas-plus",
];

// 每次构建结束（含 watch 热构建）把 main.js / manifest.json / styles.css 同步到全部 vault
const copyToVaultsPlugin = {
  name: "copy-to-vaults",
  setup(build) {
    build.onEnd(async () => {
      const { promises: fs } = await import("node:fs");
      const path = await import("node:path");
      for (const dir of pluginDirs) {
        await fs.mkdir(dir, { recursive: true });
        // 主输出目录的 main.js 由 esbuild 自己写，其余目录复制过去
        if (dir !== pluginDirs[0]) {
          await fs.copyFile(`${pluginDirs[0]}/main.js`, path.join(dir, "main.js")).catch(() => {});
        }
        await fs.copyFile("manifest.json", path.join(dir, "manifest.json")).catch(() => {});
        await fs.copyFile("styles.css", path.join(dir, "styles.css")).catch(() => {});
      }
    });
  },
};

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
  outfile: `${pluginDirs[0]}/main.js`,
  plugins: [copyToVaultsPlugin],
};

if (prod) {
  await esbuild.build(context);
} else {
  const ctx = await esbuild.context(context);
  await ctx.watch();
  console.log(`[canvas-plus] watching → ${pluginDirs.join(", ")}`);
}
