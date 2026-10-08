import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/imec-uti');
const png = Buffer.from([137,80,78,71,13,10,26,10]);
for(const [name,expected] of [
  ['icon-192.png',192],
  ['icon-512.png',512],
  ['icon-maskable-512.png',512],
  ['apple-touch-icon-180.png',180],
]){
  const content=fs.readFileSync(path.join(dir,name));
  if(!content.subarray(0,8).equals(png) || content.readUInt32BE(16)!==expected || content.readUInt32BE(20)!==expected){
    throw new Error(`Ícone PNG inválido no build: ${name}`);
  }
}
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.webmanifest'),'utf8'));
for(const size of ['192x192','512x512']){
  if(!manifest.icons.some(icon=>icon.sizes===size&&icon.type==='image/png')){
    throw new Error(`Manifest sem PNG ${size}`);
  }
}
console.log('IMEC UTI PWA: PNGs e manifest validados no artefato de produção.');
