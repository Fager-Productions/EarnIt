import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([size, name, data, checksum])
}

for (const [size, filename] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
  const scanlines = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size
      const ny = y / size
      const radius = Math.hypot(nx - 0.5, ny - 0.5)
      const coin = radius < 0.29
      const rim = coin && radius > 0.255
      const vertical = nx > 0.36 && nx < 0.4 && ny > 0.33 && ny < 0.67
      const horizontal = nx > 0.36 && nx < (ny > 0.475 && ny < 0.525 ? 0.58 : 0.64) &&
        ((ny > 0.33 && ny < 0.375) || (ny > 0.475 && ny < 0.525) || (ny > 0.625 && ny < 0.67))
      const color = vertical || horizontal ? [15, 118, 110] : rim ? [230, 126, 34] : coin ? [255, 221, 128] : [15, 118, 110]
      const offset = y * (size * 3 + 1) + 1 + x * 3
      scanlines.set(color, offset)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(fileURLToPath(new URL(`../public/${filename}`, import.meta.url)), png)
}
