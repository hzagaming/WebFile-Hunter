import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve("tests/fixtures/site");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".zip": "application/zip"
};

function createPreviewWav() {
  const sampleRate = 8000;
  const dataSize = sampleRate;
  const content = Buffer.alloc(44 + dataSize);
  content.write("RIFF", 0);
  content.writeUInt32LE(36 + dataSize, 4);
  content.write("WAVE", 8);
  content.write("fmt ", 12);
  content.writeUInt32LE(16, 16);
  content.writeUInt16LE(1, 20);
  content.writeUInt16LE(1, 22);
  content.writeUInt32LE(sampleRate, 24);
  content.writeUInt32LE(sampleRate, 28);
  content.writeUInt16LE(1, 32);
  content.writeUInt16LE(8, 34);
  content.write("data", 36);
  content.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < dataSize; index += 1) {
    const sample = 128 + Math.round(48 * Math.sin((2 * Math.PI * 440 * index) / sampleRate));
    content.writeUInt8(sample, 44 + index);
  }
  return content;
}

const previewWav = createPreviewWav();

export async function startTestServer() {
  let rateLimitHits = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const hostname = request.headers.host?.split(":", 1)[0] ?? "";
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/recursive-style") {
      response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      response.end(
        '@import "/nested-recursive.css"; .recursive-only{background:url("/files/css-recursive-only.jxl")}'
      );
      return;
    }
    if (url.pathname === "/nested-recursive.css") {
      response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      response.end('@font-face{src:url("/files/recursive-only.woff2")}');
      return;
    }
    if (hostname === "fallback.wfh.test" && url.pathname === "/robots.txt") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("User-agent: *\n");
      return;
    }
    if (
      hostname === "fallback.wfh.test" &&
      ["/sitemap.xml", "/sitemap_index.xml"].includes(url.pathname)
    ) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    if (hostname === "fallback.wfh.test" && url.pathname === "/sitemap.xml.gz") {
      const content = gzipSync(
        Buffer.from(
          '<?xml version="1.0"?><urlset><url><loc>http://fallback.wfh.test/fallback-only.html</loc></url></urlset>'
        )
      );
      response.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Length": String(content.length)
      });
      response.end(request.method === "HEAD" ? undefined : content);
      return;
    }
    if (url.pathname === "/api/header-document") {
      response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": "4" });
      response.end(request.method === "HEAD" ? undefined : "%PDF");
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
    if (url.pathname === "/api/podcast") {
      response.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": "4" });
      response.end(request.method === "HEAD" ? undefined : Buffer.from([0x49, 0x44, 0x33, 0]));
      return;
    }
    if (url.pathname === "/api/structured-video" || url.pathname === "/api/itemprop-video") {
      const content = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]);
      response.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": String(content.length)
      });
      response.end(request.method === "HEAD" ? undefined : content);
      return;
    }
    if (
      url.pathname === "/api/typed-document" ||
      url.pathname === "/api/template-document" ||
      url.pathname === "/api/late-shadow-document"
    ) {
      response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": "4" });
      response.end(request.method === "HEAD" ? undefined : "%PDF");
      return;
    }
    if (url.pathname === "/api/cross-origin") {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/vnd.webfile-hunter.resource",
        "Content-Disposition": "attachment; filename=cross-origin-resource.bin",
        "Content-Length": "5"
      });
      response.end(request.method === "HEAD" ? undefined : "cross");
      return;
    }
    if (url.pathname === "/cross-frame") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><title>跨域 Frame</title><p>跨域 Frame 公开正文</p><input value="frame-input-secret"><video preload="none" src="/files/frame-video.mp4" poster="/files/frame-poster.webp"></video>'
      );
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
    if (["/files/preview.wav", "/files/srcdoc-only.mp3"].includes(url.pathname)) {
      response.writeHead(200, {
        "Content-Type": "audio/wav",
        "Content-Length": String(previewWav.length)
      });
      response.end(request.method === "HEAD" ? undefined : previewWav);
      return;
    }
    if (url.pathname === "/files/frame-video.mp4") {
      const content = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]);
      response.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": String(content.length)
      });
      response.end(request.method === "HEAD" ? undefined : content);
      return;
    }
    if (url.pathname === "/files/shadow-video.mp4") {
      const content = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]);
      response.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": String(content.length)
      });
      response.end(request.method === "HEAD" ? undefined : content);
      return;
    }
    if (url.pathname === "/files/frame-poster.webp") {
      const icon = await readFile(resolve("public/icons/icon16.png"));
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(icon.length)
      });
      response.end(request.method === "HEAD" ? undefined : icon);
      return;
    }
    if (url.pathname === "/files/dynamic-og.webp") {
      const icon = await readFile(resolve("public/icons/icon16.png"));
      response.writeHead(200, {
        "Content-Type": "image/webp",
        "Content-Length": String(icon.length)
      });
      response.end(request.method === "HEAD" ? undefined : icon);
      return;
    }
    if (url.pathname === "/files/css-choice.avif" || url.pathname === "/files/css-choice.webp") {
      const icon = await readFile(resolve("public/icons/icon16.png"));
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(icon.length)
      });
      response.end(request.method === "HEAD" ? undefined : icon);
      return;
    }
    if (url.pathname === "/files/structured-poster.webp") {
      const icon = await readFile(resolve("public/icons/icon16.png"));
      response.writeHead(200, {
        "Content-Type": "image/webp",
        "Content-Length": String(icon.length)
      });
      response.end(request.method === "HEAD" ? undefined : icon);
      return;
    }
    if (url.pathname === "/files/icons.svg") {
      const content =
        '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="play"><path d="M0 0l8 4-8 4z"/></symbol></svg>';
      response.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Content-Length": String(Buffer.byteLength(content))
      });
      response.end(request.method === "HEAD" ? undefined : content);
      return;
    }
    if (url.pathname === "/files/filter.png") {
      const icon = await readFile(resolve("public/icons/icon16.png"));
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(icon.length)
      });
      response.end(request.method === "HEAD" ? undefined : icon);
      return;
    }
    if (
      [
        "/files/pixel.png",
        "/files/adopted-initial.webp",
        "/files/adopted-live.webp",
        "/files/lazy-background.avif",
        "/files/lazy-large.webp",
        "/files/lazy-small.webp",
        "/files/theme-background.svg"
      ].includes(url.pathname)
    ) {
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
    if (url.pathname === "/sitemap-hidden.html" && request.method === "HEAD") {
      response.writeHead(403);
      response.end();
      return;
    }
    if (url.pathname === "/nested-sitemap.xml.gz") {
      const content = gzipSync(
        Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://wfh.test/sitemap-hidden.html</loc></url></urlset>'
        )
      );
      response.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Length": String(content.length)
      });
      response.end(request.method === "HEAD" ? undefined : content);
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
        "Content-Length": String(content.length),
        ...(hostname === "wfh.test" && url.pathname === "/"
          ? {
              Link: '</api/header-document>; rel=preload; type="application/pdf", </header-next.html>; rel=next'
            }
          : {}),
        ...(hostname === "wfh.test" && url.pathname === "/page-1.html"
          ? { Refresh: "0; url=/refresh-only.html" }
          : {})
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
