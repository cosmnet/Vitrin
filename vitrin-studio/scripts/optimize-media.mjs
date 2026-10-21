import sharp from "sharp";
import { access, readdir, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

sharp.concurrency(2);
const root = path.resolve("public/assets");
const artwork = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve("artwork/collections");
await mkdir(path.join(root, "collections"), { recursive: true });
for (const id of ["solstice", "tidal", "bloom", "orbit", "play"]) {
  const original=path.join(artwork, `${id}.png`);
  if (await access(original).then(()=>true,()=>false)) await sharp(original).webp({ quality: 91, effort: 5 }).toFile(path.join(root, "collections", `${id}.webp`));
}
async function files(dir) {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true }).catch(() => []);
  const out=[];
  for(const e of entries) {
    if(e.name.startsWith(".")) continue;
    const rel=path.posix.join(dir,e.name);
    if(e.isDirectory()) out.push(...await files(rel));
    else if(/\.(png|jpe?g|webp)$/i.test(e.name)) out.push(rel);
  }
  return out;
}
const inputs=(await Promise.all(["bg","textures","brand","stickers","generated","tex","collections"].map(files))).flat();
const manifest={};let originalBytes=0,optimizedBytes=0,previewBytes=0;
for(const [i,rel] of inputs.entries()) {
  const src=path.join(root,rel), full=path.posix.join("optimized",rel+".webp"), preview=path.posix.join("previews",rel+".webp");
  await mkdir(path.dirname(path.join(root,full)),{recursive:true});
  await mkdir(path.dirname(path.join(root,preview)),{recursive:true});
  const meta=await sharp(src).metadata(), bytes=(await stat(src)).size;
  const high=await sharp(src).rotate().resize({width:3072,height:3072,fit:"inside",withoutEnlargement:true}).webp({quality:88,alphaQuality:100,effort:4}).toFile(path.join(root,full));
  const small=await sharp(src).rotate().resize({width:384,height:384,fit:"inside",withoutEnlargement:true}).webp({quality:76,alphaQuality:100,effort:3}).toFile(path.join(root,preview));
  manifest[`/assets/${rel}`]={src:`/assets/${full}`,preview:`/assets/${preview}`,width:meta.width,height:meta.height,bytes:high.size,previewBytes:small.size};
  originalBytes+=bytes;optimizedBytes+=high.size;previewBytes+=small.size;
  if((i+1)%50===0) console.log(`${i+1}/${inputs.length} optimized`);
}
await writeFile(path.join(root,"media-manifest.json"),JSON.stringify(manifest));
const report={images:inputs.length,originalBytes,optimizedBytes,previewBytes,reduction:Math.round((1-optimizedBytes/originalBytes)*100)};
await writeFile("docs/media-optimization.json",JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
