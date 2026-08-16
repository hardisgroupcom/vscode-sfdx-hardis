import * as assert from "assert";
import * as net from "net";
import { findAvailablePort } from "../../utils/portUtils";

// Binds a server to an OS-assigned port so tests can exercise findAvailablePort
// against a port that is guaranteed to be busy.
async function occupyEphemeralPort(): Promise<{
  server: net.Server;
  port: number;
}> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => resolve());
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return { server, port };
}

function releasePort(server: net.Server): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

suite("portUtils Test Suite", () => {
  test("returns a free port different from an occupied one in the range", async () => {
    const { server, port: occupiedPort } = await occupyEphemeralPort();
    assert.notStrictEqual(occupiedPort, 0);

    try {
      const foundPort = await findAvailablePort(
        occupiedPort,
        occupiedPort + 20,
      );
      assert.notStrictEqual(foundPort, occupiedPort);
      assert.ok(foundPort >= occupiedPort && foundPort <= occupiedPort + 20);
    } finally {
      await releasePort(server);
    }
  });

  test("falls back to an OS-assigned ephemeral port when the range is exhausted", async () => {
    const { server, port: occupiedPort } = await occupyEphemeralPort();

    try {
      // The single-port range [occupiedPort, occupiedPort] is exhausted (it's occupied),
      // so findAvailablePort must fall back to an ephemeral port instead of throwing.
      const foundPort = await findAvailablePort(occupiedPort, occupiedPort);
      assert.notStrictEqual(foundPort, occupiedPort);
      assert.ok(foundPort > 0);
    } finally {
      await releasePort(server);
    }
  });
});
