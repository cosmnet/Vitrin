// Reproducible third-party asset import. Never executes downloaded source code.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const revision = "dba311caff2e78c621c17f008eb1bc3f71f361b5";
const root = `https://raw.githubusercontent.com/appariciojunior/motion-studio-open/${revision}`;
const dir = resolve("public/assets/models");
const expected = "c4f66dae66bc19a1167a3764c5541cdc17bc3d05066d479a75484a54fa4c3f29";
await mkdir(`${dir}/licenses/motion-studio`, { recursive: true });
for (const [source, target, hash] of [
  ["public/3d/devices/ipadpro.glb", "ipad-pro.glb", expected],
  ["LICENSE", "licenses/motion-studio/LICENSE", null],
  ["NOTICE", "licenses/motion-studio/NOTICE", null],
]) {
  const response = await fetch(`${root}/${source}`);
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (hash && actual !== hash) throw new Error(`Hash mismatch: ${source}`);
  const existing = await readFile(`${dir}/${target}`).catch(() => null);
  if (existing && !existing.equals(bytes)) throw new Error(`Refusing to overwrite modified ${target}`);
  if (!existing) await writeFile(`${dir}/${target}`, bytes, { flag: "wx" });
  console.log(`${target}: ${bytes.length} bytes · ${actual}`);
}
