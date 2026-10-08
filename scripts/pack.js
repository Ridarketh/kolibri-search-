#!/usr/bin/env node
// Packs extension/ into dist/kolibri-<version>.zip for the Chrome Web Store or a GitHub release.
// No dependencies: a minimal ZIP writer (deflate via zlib, CRC-32, central directory).
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const extDir = path.join(root, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
const outDir = path.join(root, 'dist');
const out = path.join(outDir, `kolibri-${manifest.version}.zip`);
const SKIP = [/^\./, /\.svg\.orig$/, /~$/];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir, base) {
  const files = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (SKIP.some((re) => re.test(name))) continue;
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) files.push(...walk(full, rel));
    else files.push({ full, rel });
  }
  return files;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

const parts = [];
const central = [];
let offset = 0;
const stamp = dosTime(new Date());

for (const f of walk(extDir, '')) {
  const data = fs.readFileSync(f.full);
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const name = Buffer.from(f.rel, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt16LE(stamp.time, 10);
  local.writeUInt16LE(stamp.date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  parts.push(local, name, body);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
  cd.writeUInt16LE(stamp.time, 12);
  cd.writeUInt16LE(stamp.date, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(body.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE(offset, 42);
  central.push(cd, name);
  offset += local.length + name.length + body.length;
}

const cdSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(offset, 16);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, Buffer.concat([...parts, ...central, end]));
console.log(`${path.relative(root, out)}  (${central.length / 2} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
