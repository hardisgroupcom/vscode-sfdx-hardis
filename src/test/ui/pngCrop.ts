import * as zlib from "zlib";

// Names of the chunks of a PNG file
// cspell:ignore IHDR IDAT IEND

/**
 * Crop a PNG without an image library.
 *
 * The captures of the UI harness come from the page itself, at the size of the window. The title
 * bar (and, for recordings, the side bar) is cropped out afterwards. Asking the page for a part
 * of itself is not exact: the crop is a fraction of CSS pixels, and the image comes back one row
 * short or one row long depending on the zoom. Cutting the pixels here is exact, and the same
 * pixels always give the same bytes, which is what tells that a panel stopped changing.
 *
 * Handles what a browser screenshot is: 8 bits per channel, RGB or RGBA, not interlaced.
 */

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PngImage {
  width: number;
  height: number;
  /** Bytes per pixel: 3 (RGB) or 4 (RGBA) */
  channels: number;
  /** Rows of pixels, top to bottom, without the filter byte */
  pixels: Buffer;
}

export function decodePng(png: Buffer): PngImage {
  if (!png.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error("not a PNG file");
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace) {
        throw new Error(
          `unsupported PNG (bit depth ${bitDepth}, color type ${colorType}, interlace ${interlace})`,
        );
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  // Each row starts with the filter it was written with: undo it from the row above and the
  // pixel on the left
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    const source = row * (stride + 1) + 1;
    const target = row * stride;
    for (let index = 0; index < stride; index++) {
      const left = index >= channels ? pixels[target + index - channels] : 0;
      const up = row > 0 ? pixels[target - stride + index] : 0;
      const upLeft =
        row > 0 && index >= channels
          ? pixels[target - stride + index - channels]
          : 0;
      let value = raw[source + index];
      if (filter === 1) {
        value += left;
      } else if (filter === 2) {
        value += up;
      } else if (filter === 3) {
        value += (left + up) >> 1;
      } else if (filter === 4) {
        const estimate = left + up - upLeft;
        const distanceLeft = Math.abs(estimate - left);
        const distanceUp = Math.abs(estimate - up);
        const distanceUpLeft = Math.abs(estimate - upLeft);
        value +=
          distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
            ? left
            : distanceUp <= distanceUpLeft
              ? up
              : upLeft;
      }
      pixels[target + index] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

export function encodePng(image: PngImage): Buffer {
  const stride = image.width * image.channels;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let row = 0; row < image.height; row++) {
    // Filter 0 (none): the compression does the work, and the bytes only depend on the pixels
    image.pixels.copy(
      raw,
      row * (stride + 1) + 1,
      row * stride,
      (row + 1) * stride,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = image.channels === 4 ? 6 : 2;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The part of an image starting at (left, top), `width` wide and `height` high. A part that
 * goes past the image is cut at its edge.
 */
export function cropPng(
  png: Buffer,
  box: { left: number; top: number; width: number; height: number },
): Buffer {
  const image = decodePng(png);
  const left = Math.max(0, Math.min(box.left, image.width));
  const top = Math.max(0, Math.min(box.top, image.height));
  const width = Math.max(0, Math.min(box.width, image.width - left));
  const height = Math.max(0, Math.min(box.height, image.height - top));
  const stride = image.width * image.channels;
  const pixels = Buffer.alloc(width * image.channels * height);
  for (let row = 0; row < height; row++) {
    image.pixels.copy(
      pixels,
      row * width * image.channels,
      (top + row) * stride + left * image.channels,
      (top + row) * stride + (left + width) * image.channels,
    );
  }
  return encodePng({ width, height, channels: image.channels, pixels });
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

let crcTable: Uint32Array | null = null;
function crc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
