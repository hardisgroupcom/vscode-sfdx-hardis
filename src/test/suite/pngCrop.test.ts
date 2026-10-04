import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { cropPng, decodePng, encodePng } from "../ui/pngCrop";
import { readSourceFile } from "./lwcSourceUtils";

// cspell:ignore IHDR IDAT IEND idat

/**
 * The captures of the UI harness come from the page of the VS Code window, through the Chrome
 * DevTools Protocol, and are cropped here without an image library (src/test/ui/pngCrop.ts).
 * A capture that is one row off moves every crop box and every numbered pill of the
 * documentation, so the cut has to be exact.
 */

// A 4x3 image whose pixel (x, y) is (x * 10, y * 10, x + y), with or without alpha
function gradient(channels: number): {
  width: number;
  height: number;
  channels: number;
  pixels: Buffer;
} {
  const width = 4;
  const height = 3;
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * channels;
      pixels[at] = x * 10;
      pixels[at + 1] = y * 10;
      pixels[at + 2] = x + y;
      if (channels === 4) {
        pixels[at + 3] = 255;
      }
    }
  }
  return { width, height, channels, pixels };
}

// The same image written with one PNG filter per row, the way an encoder picks them
function encodeWithFilters(
  image: ReturnType<typeof gradient>,
  filters: number[],
): Buffer {
  const { width, height, channels, pixels } = image;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    const filter = filters[row % filters.length];
    raw[row * (stride + 1)] = filter;
    for (let index = 0; index < stride; index++) {
      const value = pixels[row * stride + index];
      const left =
        index >= channels ? pixels[row * stride + index - channels] : 0;
      const up = row > 0 ? pixels[(row - 1) * stride + index] : 0;
      const upLeft =
        row > 0 && index >= channels
          ? pixels[(row - 1) * stride + index - channels]
          : 0;
      let predicted = 0;
      if (filter === 1) {
        predicted = left;
      } else if (filter === 2) {
        predicted = up;
      } else if (filter === 3) {
        predicted = (left + up) >> 1;
      } else if (filter === 4) {
        const estimate = left + up - upLeft;
        const distances = [left, up, upLeft].map((v) => Math.abs(estimate - v));
        predicted =
          distances[0] <= distances[1] && distances[0] <= distances[2]
            ? left
            : distances[1] <= distances[2]
              ? up
              : upLeft;
      }
      raw[row * (stride + 1) + 1 + index] = (value - predicted) & 0xff;
    }
  }
  // Reuse the encoder for the chunks, then swap its pixel data for the filtered one
  const reference = encodePng(image);
  const idatStart = reference.indexOf("IDAT") - 4;
  const idatLength = reference.readUInt32BE(idatStart);
  const body = zlib.deflateSync(raw);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write("IDAT", 4, "latin1");
  // The decoder does not check the CRC: four zero bytes stand for it
  return Buffer.concat([
    reference.subarray(0, idatStart),
    head,
    body,
    Buffer.alloc(4),
    reference.subarray(idatStart + 12 + idatLength),
  ]);
}

suite("PNG crop of the UI harness captures", () => {
  test("an image written and read back holds the same pixels", () => {
    for (const channels of [3, 4]) {
      const image = gradient(channels);
      const decoded = decodePng(encodePng(image));
      assert.strictEqual(decoded.width, 4);
      assert.strictEqual(decoded.height, 3);
      assert.strictEqual(decoded.channels, channels);
      assert.ok(decoded.pixels.equals(image.pixels));
    }
  });

  test("every row filter a browser may use is undone", () => {
    const image = gradient(4);
    for (const filters of [[1], [2], [3], [4], [0, 1, 2], [4, 3, 1]]) {
      const decoded = decodePng(encodeWithFilters(image, filters));
      assert.ok(
        decoded.pixels.equals(image.pixels),
        `filters ${filters.join(",")}`,
      );
    }
  });

  test("the cut keeps exactly the pixels of the box", () => {
    const image = gradient(3);
    const cropped = decodePng(
      cropPng(encodePng(image), { left: 1, top: 1, width: 2, height: 2 }),
    );
    assert.strictEqual(cropped.width, 2);
    assert.strictEqual(cropped.height, 2);
    // First pixel of the box is (1, 1), last one is (2, 2)
    assert.deepStrictEqual([...cropped.pixels.subarray(0, 3)], [10, 10, 2]);
    assert.deepStrictEqual([...cropped.pixels.subarray(9, 12)], [20, 20, 4]);
  });

  test("a box going past the image is cut at its edge", () => {
    const cropped = decodePng(
      cropPng(encodePng(gradient(3)), {
        left: 3,
        top: 2,
        width: 10,
        height: 10,
      }),
    );
    assert.strictEqual(cropped.width, 1);
    assert.strictEqual(cropped.height, 1);
  });

  test("the same pixels always give the same bytes", () => {
    // captureStable compares two captures byte for byte to tell a panel stopped changing
    const image = gradient(4);
    assert.ok(encodePng(image).equals(encodePng(gradient(4))));
  });

  test("the screenshot suite never touches the desktop", () => {
    const suiteSource = readSourceFile("test/ui/docScreenshots.test.ts");
    assert.ok(
      !/powershell[\s\S]{0,400}(capture-window|click-window|record-window)/.test(
        suiteSource,
      ),
      "captures, clicks and recordings go through src/test/ui/cdpWindow.ts",
    );
    assert.match(suiteSource, /import \{ CdpWindow \} from "\.\/cdpWindow"/);
    assert.match(
      readSourceFile("test/runUiTest.ts"),
      /--remote-debugging-port=/,
    );
  });

  test("on Windows the window of a run is created on a desktop of its own", () => {
    // Driving the page without the real pointer is not enough: started the usual way, the
    // window still opens in front of whoever works on the machine and takes the focus
    const runner = readSourceFile("test/runUiTest.ts");
    assert.match(
      runner,
      /const hiddenDesktop =\s*process\.platform === "win32" &&\s*!process\.env\.CI &&\s*!labDriver &&\s*process\.env\.SFDX_HARDIS_UI_VISIBLE !== "true";/,
    );
    assert.match(
      runner,
      /process\.env\.SFDX_HARDIS_UI_CODE_EXE = await downloadAndUnzipVSCode\(\);/,
    );
    assert.match(
      runner,
      /\.\.\.\(vscodeExecutablePath \? \{ vscodeExecutablePath \} : \{\}\)/,
    );
    // A window nobody sees must keep rendering, for the UI tests as for the captures
    assert.match(
      runner,
      /\.\.\.\(cdpPort \|\| hiddenDesktop\s*\? \[[\s\S]*?"--disable-backgrounding-occluded-windows"/,
    );
    const root = path.resolve(__dirname, "../../../scripts/hidden-desktop");
    const wrapper = fs.readFileSync(
      path.join(root, "code-on-hidden-desktop.cmd"),
      "utf8",
    );
    assert.match(
      wrapper,
      /run-on-hidden-desktop\.ps1" "%SFDX_HARDIS_UI_CODE_EXE%" %\*/,
    );
    const launcher = fs.readFileSync(
      path.join(root, "run-on-hidden-desktop.ps1"),
      "utf8",
    );
    assert.match(launcher, /CreateDesktopW\(desktopName,/);
    assert.match(
      launcher,
      /startup\.lpDesktop = "WinSta0\\\\" \+ desktopName;/,
    );
    // It fails rather than showing the window on the desktop in use, and touches no window
    assert.match(
      launcher,
      /throw new Win32Exception\(\s*Marshal\.GetLastWin32Error\(\),\s*"CreateDesktop failed"\s*\)/,
    );
    assert.doesNotMatch(
      launcher,
      /SetForegroundWindow|bShowWindow(|SendKeys|SwitchDesktop|SetCursorPos/,
    );
  });
});
