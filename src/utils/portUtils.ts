import * as net from "net";

// Tiny local replacement for the "get-port" dependency.
// Probes each port in [start, end] by briefly binding a TCP server to it
// on all interfaces (no host argument), the same way the caller later binds
// its own server. Returns the first free port found.

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probeServer = net.createServer();
    probeServer.once("error", () => {
      resolve(false);
    });
    probeServer.once("listening", () => {
      probeServer.close(() => {
        resolve(true);
      });
    });
    probeServer.listen(port);
  });
}

export async function findAvailablePort(
  start: number,
  end: number,
): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(
    `No available port found in range ${start}-${end}`,
  );
}
