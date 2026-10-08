import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/imec-uti');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, payload) {
  const id = Buffer.from(type, 'ascii');
  const buffer = Buffer.concat([id, payload]);
  const result = Buffer.alloc(12 + payload.length);
  result.writeUInt32BE(payload.length, 0);
  buffer.copy(result, 4);
  result.writeUInt32BE(crc32(buffer), 8 + payload.length);
  return result;
}
function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const start = y * (1 + width * 4);
    raw[start] = 0; // PNG filter None
    pixels.copy(raw, start + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function roundedRect(x, y, left, top, width, height, radius) {
  if (x < left || y < top || x > left + width || y > top + height) return false;
  const cx = Math.max(left + radius, Math.min(x, left + width - radius));
  const cy = Math.max(top + radius, Math.min(y, top + height - radius));
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}
function colorAt(x, y, maskable) {
  const bg = [11,111,114];
  const dark = [7,87,90];
  const white = [255,255,255];
  const accent = [157,217,217];
  const dx = x - 256, dy = y - 256;
  let color = bg;
  if (maskable ? (dx*dx + dy*dy <= 184*184) : roundedRect(x,y,82,82,348,348,92)) color=dark;
  if ((x>=190 && x<=322 && y>=150 && y<=198) ||
      (x>=232 && x<=280 && y>=198 && y<=314) ||
      (x>=190 && x<=322 && y>=314 && y<=362)) color=white;
  if ((x-256)**2 + (y-404)**2 <= 18**2) color=accent;
  return color;
}
function makeIcon(size,maskable) {
  const pixels=Buffer.alloc(size * size * 4);
  const supersamples=[[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    let r=0,g=0,b=0;
    for(const [xx,yy] of supersamples){
      const [cr,cg,cb]=colorAt((x+xx)*512/size,(y+yy)*512/size,maskable);
      r+=cr;g+=cg;b+=cb;
    }
    const offset=(y*size+x)*4;
    pixels[offset]=Math.round(r/4);
    pixels[offset+1]=Math.round(g/4);
    pixels[offset+2]=Math.round(b/4);
    pixels[offset+3]=255;
  }
  return encodePng(size,size,pixels);
}
for(const [name,size,maskable] of [
  ['icon-192.png',192,false],
  ['icon-512.png',512,false],
  ['icon-maskable-512.png',512,true],
  ['apple-touch-icon-180.png',180,false],
]){
  fs.writeFileSync(path.join(target,name),makeIcon(size,maskable));
}
console.log('IMEC UTI PWA: PNGs 192px, 512px, maskable 512px e Apple 180px gerados.');
