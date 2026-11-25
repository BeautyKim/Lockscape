import esbuild from "esbuild";

const watch = process.argv[2] === "watch";
const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  outfile: "main.js",
  sourcemap: false,
  minify: false, // keep readable for audit
  logLevel: "info",
});
if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
