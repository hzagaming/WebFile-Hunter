import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve("tests/fixtures/site");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".zip": "application/zip"
};

export async function startTestServer() {
  let rateLimitHits = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/api/download") {
      response.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Disposition": "attachment; filename*=UTF-8''report%20fixture.txt",
        "Content-Length": "12",
        "Accept-Ranges": "bytes"
      });
      response.end(request.method === "HEAD" ? undefined : "hello report");
      return;
    }
    if (url.pathname === "/files/example.mp3") {
      response.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": "4",
        ETag: '"test-audio"'
      });
      response.end(request.method === "HEAD" ? undefined : Buffer.from([0x49, 0x44, 0x33, 0x00]));
      return;
    }
    if (url.pathname === "/files/pixel.png") {
      const icon = await readFile(resolve("public/icons/icon16.png"));
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(icon.length)
      });
      response.end(request.method === "HEAD" ? undefined : icon);
      return;
    }
    if (url.pathname === "/redirect-file") {
      response.writeHead(302, { Location: "/files/sample.txt" });
      response.end();
      return;
    }
    if (url.pathname === "/rate-limit") {
      rateLimitHits += 1;
      if (rateLimitHits < 2) response.writeHead(429, { "Retry-After": "1" });
      else response.writeHead(200, { "Content-Type": "text/html" });
      response.end(rateLimitHits < 2 ? "稍后重试" : "<!doctype html><title>恢复</title>");
      return;
    }
    if (url.pathname === "/forbidden") {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if (url.pathname === "/slow-page") {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<!doctype html><title>慢页面</title>");
      }, 2000);
      return;
    }
    const relative =
      url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = resolve(root, relative);
    if (!file.startsWith(`${root}${sep}`) && file !== root) {
      response.writeHead(400);
      response.end("Bad path");
      return;
    }
    try {
      const content = await readFile(file);
      response.writeHead(200, {
        "Content-Type": mimeTypes[extname(file)] ?? "application/octet-stream",
        "Content-Length": String(content.length)
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务器启动失败。");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () =>
      new Promise((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise()))
      )
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const server = await startTestServer();
  console.log(server.origin);
}
