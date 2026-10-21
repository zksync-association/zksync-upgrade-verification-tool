// Makes dist/verifier.html: the built page with its script and stylesheet inside it, one file.
// Another build's: node standalone/inline.mjs <its dist folder> <file name>.
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [folder, name = "verifier.html"] = process.argv.slice(2);
const dist = folder
  ? pathToFileURL(`${folder.replace(/\/$/, "")}/`)
  : new URL("./dist/", import.meta.url);
let html = readFileSync(new URL("index.html", dist), "utf8");
const read = (href) => readFileSync(new URL(`.${href}`, dist), "utf8");
html = html.replace(
  /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
  (_, href) => `<style>${read(href)}</style>`
);
html = html.replace(
  /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
  (_, src) => `<script type="module">${read(src).replaceAll("</script", "<\\/script")}</script>`
);
if (/src="\/assets|href="\/assets/.test(html))
  throw new Error("an asset was left outside the file");
writeFileSync(new URL(name, dist), html);
for (const f of readdirSync(new URL("assets/", dist))) rmSync(new URL(`assets/${f}`, dist));
rmSync(new URL("assets/", dist), { recursive: true });
rmSync(new URL("index.html", dist));
console.log(`${new URL(name, dist).pathname}: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
