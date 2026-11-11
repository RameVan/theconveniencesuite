// Puts a Nomadraw build into assets/nomadraw/ (git-ignored) for the Worker to serve at /nomadraw/ after sign-in
// (src/nomadraw.js), as a home-screen web app called "Nomadraw WIP". Then deploy:   npm run deploy
//
//   node sync-nomadraw.mjs [path to the Nomadraw checkout]      (default: ../../Nomadraw)
//
// It runs the checkout's own build (npm run build → dist/), copies dist/ here, adds the WIP icons (nomadraw-wip/) and
// a web app manifest, and puts the home-screen tags into index.html. Only this hosted copy changes, not the checkout.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const src = resolve(process.argv[2] || join(here, "../../Nomadraw"));
if (!existsSync(join(src, "tools/build.mjs"))) throw new Error(`No Nomadraw checkout at ${src}`);
execFileSync(process.execPath, [join(src, "tools/build.mjs")], { cwd: src, stdio: "inherit" });

const out = join(here, "assets/nomadraw");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, "dist"), out, { recursive: true });
cpSync(join(here, "nomadraw-wip"), join(out, "wip"), { recursive: true });

let commit = "unknown";
try { commit = execFileSync("git", ["-C", src, "log", "-1", "--format=%h %cs %s"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
writeFileSync(join(out, "wip/build.txt"), `${commit}\nsynced ${new Date().toISOString()}\n`);

writeFileSync(join(out, "manifest.webmanifest"), JSON.stringify({
  name: "Nomadraw WIP", short_name: "Nomadraw WIP", description: "Work in progress: draw your road trip.",
  id: "/nomadraw/", start_url: "/nomadraw/", scope: "/nomadraw/", display: "standalone", orientation: "any",
  background_color: "#141412", theme_color: "#141412",
  icons: [{ src: "/nomadraw/wip/icon-180.png", sizes: "180x180", type: "image/png" }, { src: "/nomadraw/wip/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }],
}, null, 2));

const index = join(out, "index.html");
let html = readFileSync(index, "utf8");
html = html.replace(/<title>[^<]*<\/title>/, `<title>Nomadraw WIP</title>
  <meta name="robots" content="noindex">
  <link rel="manifest" href="/nomadraw/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/nomadraw/wip/icon-180.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Nomadraw WIP">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`);
writeFileSync(index, html);
console.log(`assets/nomadraw ← ${src} (${commit})`);
