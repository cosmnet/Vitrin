import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", ".next", "coverage"]);
const secretPattern = /(-----BEGIN [^-]+ PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{20,}|AKIA[0-9A-Z]{16}|(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,})/i;
const textExtensions = new Set([".js", ".json", ".md", ".mjs", ".ts", ".toml", ".yml", ".yaml", ".txt", ".env", ".example"]);
const hits = [];

async function walk(dir) {
  for (const name of await readdir(dir)) {
    if (ignored.has(name)) continue;
    const file = path.join(dir, name);
    const info = await stat(file);
    if (info.isDirectory()) {
      await walk(file);
      continue;
    }
    if (!textExtensions.has(path.extname(name)) && name !== "Dockerfile") continue;
    const content = await readFile(file, "utf8");
    content.split(/\r?\n/).forEach((line, index) => {
      if (secretPattern.test(line) && !/YOUR_|absolute\/path|example|placeholder/i.test(line)) {
        hits.push(`${path.relative(root, file)}:${index + 1}`);
      }
    });
  }
}

await walk(root);
if (hits.length) {
  console.error("Possible secret-like values found:");
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log("Secret scan passed: no credential-like values found.");
