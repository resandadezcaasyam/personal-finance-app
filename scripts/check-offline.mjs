// Scans source for runtime references to external hosts (CDNs, fonts, analytics).
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src");
const pattern = /(?:src|href|url\()\s*=?\s*["']?https?:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org)[^\s"')]+/gi;
const fetchPattern = /fetch\(\s*["'`]https?:\/\/(?!localhost|127\.0\.0\.1)/gi;
const hits = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|css|html|mjs|js)$/.test(e.name)) {
      const text = fs.readFileSync(p, "utf8");
      for (const m of text.matchAll(pattern)) hits.push(`${p}: ${m[0]}`);
      for (const m of text.matchAll(fetchPattern)) hits.push(`${p}: ${m[0]}`);
    }
  }
}
walk(root);
if (hits.length) { console.error("External references found:\n" + hits.join("\n")); process.exit(1); }
console.log("OK: no external URLs referenced in src/");
