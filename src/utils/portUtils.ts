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

// Asks the OS for an ephemeral port (equivalent to get-port's behavior when none of the
// preferred ports are available): bind a server to port 0, read back the assigned port,
// then close the server so the caller can bind its own server to it.
function getEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probeServer = net.createServer();
    probeServer.once("error", (err) => {
      reject(err);
    });
    probeServer.once("listening", () => {
      const address = probeServer.address();
      probeServer.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Unable to determine an ephemeral port"));
        }
      });
    });
    probeServer.listen(0);
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
  // Every port in the preferred range is unusable: fall back to an OS-assigned
  // ephemeral port instead of throwing, so callers still get a working port.
  try {
    return await getEphemeralPort();
  } catch (err) {
    throw new Error(
      `No available port found in range ${start}-${end}: ${
        err instanceof Error ? err.message : err
      }`,
      { cause: err },
    );
  }
}
