import * as fs from "fs";
import * as path from "path";
import WebSocket from "ws";
import { cropPng } from "./pngCrop";

// cspell:ignore IHDR

/**
 * Drives the VS Code window of the UI test harness through the Chrome DevTools Protocol.
 *
 * The documentation screenshots used to move the real mouse and to bring the window to the
 * foreground (PowerShell, user32.dll): nobody could use the machine during a run, and it only
 * worked on Windows. VS Code is an Electron application: started with a remote debugging port
 * (see src/test/runUiTest.ts), its window answers the same protocol as a browser page.
 *
 * - Clicks and wheel events are dispatched to the page, not to the desktop: the real pointer
 *   never moves, and the window does not need the focus, nor to be visible on top.
 * - Captures are rendered by the page itself, at a size and a pixel ratio set here, whatever the
 *   size of the real window and the scale of the display. A capture is the same on every machine.
 *
 * Coordinates are the ones of a capture (device pixels, title bar cropped out), as they always
 * were in docScreenshots.test.ts.
 */

// Size of a capture in device pixels before the title bar is cropped out, and the pixel ratio of
// the display the existing captures were taken on (1920x1020 at 125%): the crop boxes of
// scripts/build-doc-images.py and the pill positions of the documentation rely on them
export const CAPTURE_WIDTH = 1920;
export const CAPTURE_HEIGHT = 1020;
export const DEVICE_SCALE_FACTOR = 1.25;

// Whether the coordinates of an input event follow the zoom of VS Code
const INPUT_FOLLOWS_ZOOM = process.env.SFDX_HARDIS_UI_CDP_INPUT_DIP !== "true";

interface Pending {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
}

export interface CaptureCrop {
  top?: number;
  bottom?: number;
  left?: number;
}

export class CdpWindow {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly port: number) {}

  /** The port the harness started VS Code with, or 0 when it did not. */
  static portFromEnv(): number {
    const port = Number(process.env.SFDX_HARDIS_UI_CDP_PORT || "");
    return Number.isInteger(port) && port > 0 ? port : 0;
  }

  /**
   * Attach to the workbench page of the window and give it the size of a capture.
   */
  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }
    const target = await this.findWorkbenchTarget();
    this.socket = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(target.webSocketDebuggerUrl, {
        perMessageDeflate: false,
      });
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });
    this.socket.on("message", (data) => this.onMessage(data.toString()));
    this.socket.on("close", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("the window closed its debugging connection"));
      }
      this.pending.clear();
      this.socket = null;
    });
    // A page that believes it has the focus, of the size and pixel ratio of the documentation
    // captures: the window can be covered, small or behind another one
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    // The size is in pixels of the window that the zoom of VS Code does not change: zoomed out,
    // the page lays out more CSS pixels in the same window, and a capture keeps its size
    await this.send("Emulation.setDeviceMetricsOverride", {
      width: Math.round(CAPTURE_WIDTH / DEVICE_SCALE_FACTOR),
      height: Math.round(CAPTURE_HEIGHT / DEVICE_SCALE_FACTOR),
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      mobile: false,
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  /**
   * Save the window as a PNG, with the given number of device pixels cropped out of its edges.
   * Returns the width and the height of the image.
   */
  async capture(
    file: string,
    crop: CaptureCrop = {},
  ): Promise<{ width: number; height: number }> {
    await this.connect();
    const top = crop.top ?? 0;
    const left = crop.left ?? 0;
    const width = CAPTURE_WIDTH - left;
    const height = CAPTURE_HEIGHT - top - (crop.bottom ?? 0);
    // The whole page is captured, then cut here: asking the page for a part of itself is a
    // fraction of CSS pixels, which comes back one row short or one row long depending on the zoom
    const result = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const png = cropPng(Buffer.from(result.data, "base64"), {
      left,
      top,
      width,
      height,
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, png);
    // Width and height are the two big-endian integers after the IHDR chunk header
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  }

  /**
   * Save the whole window as a PNG, as the page gives it: nothing is cropped and the image is
   * compressed for speed. A capture() decodes, crops and encodes each image, which takes longer
   * than a frame of a recording lasts: its frames are cropped when the GIF is assembled.
   */
  async captureRaw(file: string): Promise<void> {
    await this.connect();
    const result = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      optimizeForSpeed: true,
    });
    fs.writeFileSync(file, Buffer.from(result.data, "base64"));
  }

  /**
   * Click at a point of a capture (device pixels, `cropTop` pixels cropped out at the top), or
   * turn the wheel there when `scroll` is given (positive scrolls up, in notches, as a mouse does).
   */
  async click(
    x: number,
    y: number,
    options: { scroll?: number; cropTop?: number } = {},
  ): Promise<void> {
    await this.connect();
    const zoom = INPUT_FOLLOWS_ZOOM ? await this.zoomFactor() : 1;
    // Input coordinates are CSS pixels of the page when INPUT_FOLLOWS_ZOOM, else device
    // independent pixels of the window that the zoom of VS Code does not change
    const inputScale = DEVICE_SCALE_FACTOR * zoom;
    const pageX = x / inputScale;
    const pageY = (y + (options.cropTop ?? 0)) / inputScale;
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: pageX,
      y: pageY,
    });
    if (options.scroll) {
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: pageX,
        y: pageY,
        deltaX: 0,
        // One notch of a mouse wheel is 120 units, and scrolling down is a positive delta
        deltaY: -options.scroll * 120,
      });
      return;
    }
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", {
        type,
        x: pageX,
        y: pageY,
        button: "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: 1,
      });
    }
  }

  /**
   * Type text into whatever has the focus in the window, as the page receives it from an input
   * method: no key of the real keyboard is involved.
   */
  async type(text: string): Promise<void> {
    await this.connect();
    await this.send("Input.insertText", { text });
  }

  /** Zoom factor of the window (VS Code zoom in / zoom out), 1 when not zoomed. */
  private async zoomFactor(): Promise<number> {
    const result = await this.send("Runtime.evaluate", {
      expression: "window.devicePixelRatio",
      returnByValue: true,
    });
    const ratio = Number(result?.result?.value);
    return ratio > 0 ? ratio / DEVICE_SCALE_FACTOR : 1;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const socket = this.socket;
    if (!socket) {
      return Promise.reject(new Error("not connected to the window"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} got no answer from the window`));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  private onMessage(raw: string): void {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const waiting = this.pending.get(message.id);
    if (!waiting) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error) {
      waiting.reject(new Error(message.error.message || "protocol error"));
    } else {
      waiting.resolve(message.result);
    }
  }

  // The page of the VS Code window, among the targets of the application (webviews, workers and
  // shared processes are targets too)
  private async findWorkbenchTarget(): Promise<{
    webSocketDebuggerUrl: string;
  }> {
    const start = Date.now();
    let lastError = "";
    while (Date.now() - start < 20000) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/json/list`);
        const targets: any[] = await response.json();
        const workbench = targets.find(
          (target) =>
            target.type === "page" &&
            typeof target.url === "string" &&
            target.url.includes("workbench") &&
            target.webSocketDebuggerUrl,
        );
        if (workbench) {
          return workbench;
        }
        lastError = `no workbench page among ${targets.length} target(s)`;
      } catch (error: any) {
        lastError = error?.message || String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      `VS Code does not answer on its debugging port ${this.port}: ${lastError}`,
    );
  }
}
