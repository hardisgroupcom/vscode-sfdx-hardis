import * as assert from "assert";
import * as http from "http";
import { getJson, getText, ping, HttpError } from "../../utils/httpUtils";

suite("httpUtils Test Suite", () => {
  let server: http.Server;
  let baseUrl: string;

  suiteSetup(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ hello: "world" }));
        return;
      }
      if (req.url === "/text") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("hello world");
        return;
      }
      if (req.url === "/notfound") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      if (req.url === "/error") {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("server error");
        return;
      }
      if (req.url === "/slow") {
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("done");
        }, 2000);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  suiteTeardown(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("getJson parses a JSON 200 response", async () => {
    const result = await getJson<{ hello: string }>(`${baseUrl}/json`);
    assert.strictEqual(result.hello, "world");
  });

  test("getText returns the body of a text 200 response", async () => {
    const result = await getText(`${baseUrl}/text`);
    assert.strictEqual(result, "hello world");
  });

  test("ping resolves on a 200 response", async () => {
    await assert.doesNotReject(() => ping(`${baseUrl}/text`));
  });

  test("getJson throws an HttpError with status 404 on non-2xx response", async () => {
    await assert.rejects(
      () => getJson(`${baseUrl}/notfound`),
      (e: any) => {
        assert.ok(e instanceof HttpError);
        assert.strictEqual(e.status, 404);
        return true;
      },
    );
  });

  test("getText throws an HttpError with status 500 on server error", async () => {
    await assert.rejects(
      () => getText(`${baseUrl}/error`),
      (e: any) => {
        assert.ok(e instanceof HttpError);
        assert.strictEqual(e.status, 500);
        return true;
      },
    );
  });

  test("getText aborts with a timeout on a slow response", async () => {
    await assert.rejects(() => getText(`${baseUrl}/slow`, { timeoutMs: 200 }));
  }).timeout(5000);
});
