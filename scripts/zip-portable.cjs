const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function modeFor(relativePosix, kind) {
  if (kind === 'dir') return S_IFDIR | 0o755;
  if (kind === 'link') return S_IFLNK | 0o755;
  const base = relativePosix.split('/').pop();
  if (base.startsWith('.') && !base.endsWith('.sh') && !base.endsWith('.command')) return S_IFREG | 0o644;
  const executable = base.endsWith('.sh') || base.endsWith('.command') || base === 'chrome-sandbox'
    || relativePosix.includes('/Contents/MacOS/')
    || /\.(dylib|so|node)$/.test(base)
    || path.posix.extname(base) === '';
  return S_IFREG | (executable ? 0o755 : 0o644);
}

function crcUpdate(crc, buf) {
  let c = crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

function dosFields(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function skipDir(name) {
  return name === 'data' || name === '.tmp';
}

async function listEntries(sourceDir) {
  const rootName = path.basename(sourceDir);
  const entries = [];
  async function walk(abs, rel) {
    const stat = await fs.promises.lstat(abs);
    if (stat.isSymbolicLink()) {
      entries.push({ abs, rel: rel.replace(/\\/g, '/'), kind: 'link' });
      return;
    }
    if (stat.isDirectory()) {
      if (rel && skipDir(path.posix.basename(rel.replace(/\\/g, '/')))) return;
      if (rel) entries.push({ abs, rel: rel.replace(/\\/g, '/'), kind: 'dir' });
      for (const child of await fs.promises.readdir(abs)) await walk(path.join(abs, child), path.join(rel, child));
      return;
    }
    entries.push({ abs, rel: rel.replace(/\\/g, '/'), kind: 'file' });
  }
  await walk(sourceDir, rootName);
  return entries;
}

function write(stream, buf) {
  return new Promise((resolve, reject) => {
    stream.write(buf, error => error ? reject(error) : resolve());
  });
}

async function zipDirectory(sourceDir, destZip) {
  const entries = await listEntries(sourceDir);
  const date = dosFields(new Date());
  await fs.promises.mkdir(path.dirname(destZip), { recursive: true });
  const stream = fs.createWriteStream(destZip);
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.kind === 'dir' ? `${entry.rel}/` : entry.rel);
    const mode = modeFor(entry.rel, entry.kind);
    let method = 0;
    let body = Buffer.alloc(0);
    let crc = 0;
    let size = 0;
    if (entry.kind === 'link') {
      body = Buffer.from(await fs.promises.readlink(entry.abs));
      size = body.length;
      crc = crcUpdate(0xffffffff, body) ^ 0xffffffff;
    } else if (entry.kind === 'file') {
      const raw = await fs.promises.readFile(entry.abs);
      size = raw.length;
      crc = crcUpdate(0xffffffff, raw) ^ 0xffffffff;
      if (size > 0) {
        body = zlib.deflateRawSync(raw, { level: 6 });
        method = 8;
      }
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(date.time, 10);
    local.writeUInt16LE(date.day, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    await write(stream, local);
    await write(stream, name);
    if (body.length) await write(stream, body);
    const madeBy = Buffer.alloc(46);
    madeBy.writeUInt32LE(0x02014b50, 0);
    madeBy.writeUInt16LE((3 << 8) | 20, 4);
    madeBy.writeUInt16LE(20, 6);
    madeBy.writeUInt16LE(0, 8);
    madeBy.writeUInt16LE(method, 10);
    madeBy.writeUInt16LE(date.time, 12);
    madeBy.writeUInt16LE(date.day, 14);
    madeBy.writeUInt32LE(crc >>> 0, 16);
    madeBy.writeUInt32LE(body.length, 20);
    madeBy.writeUInt32LE(size, 24);
    madeBy.writeUInt16LE(name.length, 28);
    madeBy.writeUInt16LE(0, 30);
    madeBy.writeUInt16LE(0, 32);
    madeBy.writeUInt16LE(0, 34);
    madeBy.writeUInt16LE(0, 36);
    madeBy.writeUInt32LE((mode << 16) >>> 0, 38);
    madeBy.writeUInt32LE(offset, 42);
    central.push(madeBy, name);
    offset += local.length + name.length + body.length;
  }
  const centralOffset = offset;
  let centralSize = 0;
  for (const part of central) {
    await write(stream, part);
    centralSize += part.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  await write(stream, end);
  await new Promise((resolve, reject) => stream.end(error => error ? reject(error) : resolve()));
}

if (require.main === module) {
  const [source, dest] = process.argv.slice(2);
  if (!source || !dest) {
    console.error('usage: zip-portable.cjs <folder> <archive.zip>');
    process.exit(1);
  }
  zipDirectory(path.resolve(source), path.resolve(dest)).catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { modeFor, zipDirectory };
