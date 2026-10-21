#!/usr/bin/env node
// node scripts/fetch-curated-fonts.mjs
// Full, unmodified variable TTFs from a pinned primary Google Fonts revision.
// Existing files are verified byte-for-byte, never overwritten.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const revision = "23e54b51ddffbc7713c583748e3bd86f62b1fa4a";
const root = new URL("../public/assets/fonts/curated/", import.meta.url);
const families = [
  ["Plus Jakarta Sans", "plusjakartasans", "PlusJakartaSans[wght].ttf"],
  ["DM Sans", "dmsans", "DMSans[opsz,wght].ttf"],
  ["Onest", "onest", "Onest[wght].ttf"],
  ["Urbanist", "urbanist", "Urbanist[wght].ttf"],
  ["Bodoni Moda", "bodonimoda", "BodoniModa[opsz,wght].ttf"],
  ["Newsreader", "newsreader", "Newsreader[opsz,wght].ttf"],
  ["Commissioner", "commissioner", "Commissioner[FLAR,VOLM,slnt,wght].ttf"],
  ["Rubik", "rubik", "Rubik[wght].ttf"],
];

async function preserveOrWrite(destination, bytes) {
  try {
    await writeFile(destination, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!(await readFile(destination)).equals(bytes)) {
      throw new Error(`Existing file differs; refusing to overwrite ${fileURLToPath(destination)}`);
    }
  }
}

async function download(id, name) {
  const url = `https://raw.githubusercontent.com/google/fonts/${revision}/ofl/${id}/${encodeURIComponent(name)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (name.endsWith(".ttf") && (bytes.length < 1024 || bytes.readUInt32BE(0) !== 0x00010000)) {
    throw new Error(`Invalid TrueType asset: ${url}`);
  }
  if (name === "OFL.txt" && !bytes.toString().includes("SIL OPEN FONT LICENSE")) {
    throw new Error(`Expected OFL license: ${url}`);
  }
  return { bytes, source: url, sha256: createHash("sha256").update(bytes).digest("hex") };
}

await mkdir(root, { recursive: true });
const manifest = [];
// All jobs settle before reporting errors, so a failed download exits nonzero.
const results = await Promise.allSettled(families.map(async ([family, id, filename]) => {
  const dir = new URL(`${id}/`, root);
  await mkdir(dir, { recursive: true });
  const assets = [];
  for (const [upstream, local] of [[filename, "roman.ttf"], ["OFL.txt", "OFL.txt"], ["METADATA.pb", "METADATA.pb"]]) {
    const { bytes, source, sha256 } = await download(id, upstream);
    await preserveOrWrite(new URL(local, dir), bytes);
    assets.push({ file: `${id}/${local}`, source, sha256, bytes: bytes.length });
  }
  console.log(`${family}: TTF, OFL and upstream metadata verified`);
  return { family, license: "OFL-1.1", registeredWeights: [400, 600, 700], assets };
}));
for (const result of results) {
  if (result.status === "rejected") console.error(result.reason);
  else manifest.push(result.value);
}
if (results.some(result => result.status === "rejected")) process.exitCode = 1;
else {
  await preserveOrWrite(new URL("provenance.json", root), Buffer.from(JSON.stringify({
    repository: "https://github.com/google/fonts", revision, families: manifest,
  }, null, 2) + "\n"));
  console.log(`Verified ${manifest.length} families; provenance.json includes source URLs and SHA-256 hashes.`);
}
