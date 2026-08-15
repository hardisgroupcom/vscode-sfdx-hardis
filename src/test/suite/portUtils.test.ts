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

  test("throws when no port is free in the given range", async () => {
    const occupiedServer = net.createServer();
    await new Promise<void>((resolve, reject) => {
      occupiedServer.once("error", reject);
      occupiedServer.listen(0, () => resolve());
    });
    const address = occupiedServer.address();
    const occupiedPort =
      typeof address === "object" && address !== null ? address.port : 0;

    try {
      await assert.rejects(() =>
        findAvailablePort(occupiedPort, occupiedPort),
      );
    } finally {
      await new Promise<void>((resolve) => occupiedServer.close(() => resolve()));
    }
  });
});
