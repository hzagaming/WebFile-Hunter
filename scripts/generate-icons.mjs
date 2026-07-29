import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sizes = [16, 32, 48, 128];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, body, crc]);
}

function insideRoundedSquare(x, y, size, inset, radius) {
  const left = inset;
  const right = size - inset - 1;
  const top = inset;
  const bottom = size - inset - 1;
  const clampedX = Math.max(left + radius, Math.min(right - radius, x));
  const clampedY = Math.max(top + radius, Math.min(bottom - radius, y));
  return (x - clampedX) ** 2 + (y - clampedY) ** 2 <= radius ** 2;
}

function makeIcon(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 128;
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    pixels[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      let color = [0, 0, 0, 0];
      if (
        insideRoundedSquare(x, y, size, Math.max(1, Math.round(3 * scale)), Math.max(2, 24 * scale))
      ) {
        const blend = y / size;
        color = [
          Math.round(12 + 5 * blend),
          Math.round(105 + 50 * blend),
          Math.round(155 + 37 * blend),
          255
        ];
      }
      const px = x / scale;
      const py = y / scale;
      if (px >= 31 && px <= 82 && py >= 24 && py <= 94) color = [246, 250, 252, 255];
      if (px >= 66 && px <= 82 && py >= 24 && py <= 40 && px + py >= 106)
        color = [121, 219, 207, 255];
      if (px >= 41 && px <= 69 && py >= 48 && py <= 53) color = [27, 113, 155, 255];
      if (px >= 41 && px <= 63 && py >= 61 && py <= 66) color = [27, 113, 155, 255];
      const distance = Math.hypot(px - 76, py - 78);
      if (distance >= 16 && distance <= 23) color = [255, 169, 46, 255];
      const handleDistance = Math.abs(py - 95 - (px - 93));
      if (px >= 88 && px <= 108 && py >= 90 && py <= 112 && handleDistance <= 5) {
        color = [255, 169, 46, 255];
      }
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const iconDirectory = resolve("public/icons");
await mkdir(iconDirectory, { recursive: true });
await Promise.all(
  sizes.map((size) => writeFile(resolve(iconDirectory, `icon${size}.png`), makeIcon(size)))
);
