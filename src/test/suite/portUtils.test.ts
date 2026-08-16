import * as assert from "assert";
import * as net from "net";
import { findAvailablePort } from "../../utils/portUtils";

suite("portUtils Test Suite", () => {
  test("returns a free port different from an occupied one in the range", async () => {
    const occupiedServer = net.createServer();
    await new Promise<void>((resolve, reject) => {
      occupiedServer.once("error", reject);
      occupiedServer.listen(0, () => resolve());
    });
    const address = occupiedServer.address();
    const occupiedPort =
      typeof address === "object" && address !== null ? address.port : 0;
    assert.notStrictEqual(occupiedPort, 0);

    try {
      const foundPort = await findAvailablePort(
        occupiedPort,
        occupiedPort + 20,
      );
      assert.notStrictEqual(foundPort, occupiedPort);
      assert.ok(foundPort >= occupiedPort && foundPort <= occupiedPort + 20);
    } finally {
      await new Promise<void>((resolve) => occupiedServer.close(() => resolve()));
    }
  });

  test("falls back to an OS-assigned ephemeral port when the range is exhausted", async () => {
    const occupiedServer = net.createServer();
    await new Promise<void>((resolve, reject) => {
      occupiedServer.once("error", reject);
      occupiedServer.listen(0, () => resolve());
    });
    const address = occupiedServer.address();
    const occupiedPort =
      typeof address === "object" && address !== null ? address.port : 0;

    try {
      // The single-port range [occupiedPort, occupiedPort] is exhausted (it's occupied),
      // so findAvailablePort must fall back to an ephemeral port instead of throwing.
      const foundPort = await findAvailablePort(occupiedPort, occupiedPort);
      assert.notStrictEqual(foundPort, occupiedPort);
      assert.ok(foundPort > 0);
    } finally {
      await new Promise<void>((resolve) => occupiedServer.close(() => resolve()));
    }
  });
});
