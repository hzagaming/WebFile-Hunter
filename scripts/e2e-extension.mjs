import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startTestServer } from "./test-server.mjs";
import { findEdgeExecutable } from "./edge-paths.mjs";

const edgePath = await findEdgeExecutable();
await access(resolve("dist/manifest.json"));

const tempRoot = await mkdtemp(join(tmpdir(), "webfile-hunter-edge-"));
const profile = join(tempRoot, "profile");
const extensionDirectory = join(tempRoot, "extension");
const downloadsDirectory = join(tempRoot, "downloads");
await mkdir(profile, { recursive: true });
await mkdir(downloadsDirectory, { recursive: true });
await cp(resolve("dist"), extensionDirectory, { recursive: true });
const testManifestPath = join(extensionDirectory, "manifest.json");
const testManifest = JSON.parse(await readFile(testManifestPath, "utf8"));
const server = await startTestServer();
const recursiveOrigin = "http://wfh.test";
const fallbackOrigin = "http://fallback.wfh.test";
const ungrantedOrigin = "http://ungranted.wfh.test";
const cdnOrigin = "http://cdn.wfh.test";
testManifest.host_permissions = ["http://*/*", "https://*/*"];
await writeFile(testManifestPath, JSON.stringify(testManifest));
let context;
const browserErrors = [];

function watchPage(page, label) {
  page.on("pageerror", (error) => browserErrors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    browserErrors.push(
      `${label} console: ${message.text()}${location.url ? ` (${location.url}:${location.lineNumber})` : ""}`
    );
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  if (dimensions.scrollWidth > dimensions.clientWidth) {
    throw new Error(`${label} 存在横向溢出：${JSON.stringify(dimensions)}`);
  }
}

async function assertAccessibleControls(page, label) {
  const issues = await page.evaluate(() =>
    [...document.querySelectorAll("button,input,select,textarea,summary")]
      .filter((element) => {
        if (element.closest("details:not([open])")) return false;
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          (!element.checkVisibility ||
            element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        );
      })
      .flatMap((element) => {
        const labels =
          "labels" in element ? [...element.labels].map((label) => label.innerText) : [];
        const labelledBy = element.getAttribute("aria-labelledby");
        const labelledText = labelledBy
          ? labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" ")
          : "";
        const name = [
          element.getAttribute("aria-label") ?? "",
          labelledText,
          ...labels,
          element.textContent ?? "",
          element.getAttribute("title") ?? ""
        ]
          .join(" ")
          .trim();
        const box = element.getBoundingClientRect();
        const problems = [];
        if (!name) problems.push("缺少可访问名称");
        if (element instanceof HTMLButtonElement && (box.width < 24 || box.height < 24)) {
          problems.push(`按钮目标过小 ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
        return problems.map(
          (problem) =>
            `${element.tagName.toLowerCase()}[type=${element.getAttribute("type") ?? ""}]: ${problem} ${element.outerHTML.slice(0, 140)}`
        );
      })
  );
  if (issues.length) throw new Error(`${label} 可访问性检查失败：${issues.join("；")}`);
}

async function assertResponsive(page, label) {
  for (const width of [280, 320, 380]) {
    await page.setViewportSize({ width, height: 820 });
    await assertNoHorizontalOverflow(page, `${label}（${width}px）`);
    await assertAccessibleControls(page, `${label}（${width}px）`);
  }
}

async function assertMotionAndFocusAccessibility(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const values = await page.evaluate(() => {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    document.body.append(spinner);
    const spinnerStyle = getComputedStyle(spinner);
    const button = [...document.querySelectorAll("button")].find(
      (item) => !item.disabled && item.getBoundingClientRect().width > 0
    );
    button?.focus();
    const buttonStyle = button ? getComputedStyle(button) : undefined;
    const output = {
      animationIterationCount: spinnerStyle.animationIterationCount,
      outlineColor: buttonStyle?.outlineColor,
      outlineWidth: buttonStyle?.outlineWidth
    };
    button?.blur();
    spinner.remove();
    return output;
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const alpha = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(values.outlineColor ?? "")?.[1];
  if (
    values.animationIterationCount !== "1" ||
    Number.parseFloat(values.outlineWidth ?? "0") < 2 ||
    (alpha !== undefined && Number(alpha) < 0.8)
  ) {
    throw new Error(`动效或焦点无障碍检查失败：${JSON.stringify(values)}`);
  }
}

async function assertResultCardControls(page, filename, expectedButtons) {
  for (const width of [280, 320, 380]) {
    await page.setViewportSize({ width, height: 820 });
    const card = page.locator(".result-card").filter({
      has: page.getByTitle(filename, { exact: true })
    });
    await card.waitFor();
    const bounds = await card.evaluate((element) => {
      const cardBox = element.getBoundingClientRect();
      const actions = element.querySelector(".card-actions")?.getBoundingClientRect();
      const visibleButtons = [...element.querySelectorAll(".card-actions button")].filter(
        (button) => {
          const box = button.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        }
      ).length;
      return {
        cardTop: cardBox.top,
        cardBottom: cardBox.bottom,
        actionsTop: actions?.top,
        actionsBottom: actions?.bottom,
        visibleButtons
      };
    });
    if (
      bounds.actionsTop === undefined ||
      bounds.actionsBottom === undefined ||
      bounds.actionsTop < bounds.cardTop ||
      bounds.actionsBottom > bounds.cardBottom ||
      bounds.visibleButtons !== expectedButtons
    ) {
      throw new Error(`极端结果卡操作区被裁切（${width}px）：${JSON.stringify(bounds)}`);
    }
  }
}

async function assertActiveNavigation(page, label) {
  const active = await page.locator(".tabs button.active").allTextContents();
  if (active.length !== 1 || !active[0]?.includes(label)) {
    throw new Error(`${label}导航状态异常：${JSON.stringify(active)}`);
  }
  await page.waitForTimeout(200);
}

async function assertLastResultUnobscured(page) {
  for (const width of [280, 320, 380]) {
    await page.setViewportSize({ width, height: 820 });
    const list = page.getByRole("region", { name: "扫描结果列表" });
    await list.focus();
    await list.press("End");
    const positions = await page.evaluate(() => {
      const items = document.querySelectorAll('[role="listitem"]');
      const last = items.item(items.length - 1).getBoundingClientRect();
      const actions = document.querySelector(".sticky-actions")?.getBoundingClientRect();
      return { lastBottom: last.bottom, actionsTop: actions?.top };
    });
    if (positions.actionsTop === undefined || positions.lastBottom > positions.actionsTop) {
      throw new Error(`末项被批量操作栏遮挡（${width}px）：${JSON.stringify(positions)}`);
    }
  }
}

async function eventually(read, accept, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(`等待条件超时：${JSON.stringify(last)}`);
}

async function send(extensionPage, message) {
  const response = await extensionPage.evaluate(
    (value) =>
      new Promise((resolvePromise, reject) => {
        chrome.runtime.sendMessage(value, (result) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolvePromise(result);
        });
      }),
    message
  );
  if (!response?.ok) throw new Error(response?.error?.message ?? "扩展消息失败。");
  return response.data;
}

async function browserDownloads(worker) {
  return worker.evaluate(() => chrome.downloads.search({}));
}

async function prepareDownloadCapture(target) {
  return target.evaluate(() => {
    if (!globalThis.__wfhDownloadRequests) {
      const originalDownload = chrome.downloads.download.bind(chrome.downloads);
      globalThis.__wfhDownloadRequests = [];
      chrome.downloads.download = (options) => {
        globalThis.__wfhDownloadRequests.push({
          filename: options.filename,
          saveAs: options.saveAs
        });
        return originalDownload(options);
      };
    }
    return globalThis.__wfhDownloadRequests.length;
  });
}

async function capturedDownloadRequest(target, index) {
  return eventually(
    () => target.evaluate((position) => globalThis.__wfhDownloadRequests?.[position], index),
    (request) => Boolean(request)
  );
}

async function captureDownload(page, worker, action, acceptFilename, label) {
  const existingIds = new Set((await browserDownloads(worker)).map((item) => item.id));
  const requestIndex = await prepareDownloadCapture(page);
  const downloadPromise = page.waitForEvent("download");
  await action();
  const download = await downloadPromise;
  const requested = await capturedDownloadRequest(page, requestIndex);
  if (!requested?.filename || !acceptFilename(requested.filename)) {
    throw new Error(`${label} 文件名不正确：${requested?.filename ?? "未提交文件名"}`);
  }
  const startedRows = await eventually(
    () => browserDownloads(worker),
    (items) => items.some((item) => !existingIds.has(item.id))
  );
  const started = startedRows.find((item) => !existingIds.has(item.id));
  if (!started) throw new Error(`${label} 未创建浏览器下载记录。`);
  const completedRows = await eventually(
    () => browserDownloads(worker),
    (items) => {
      const item = items.find((candidate) => candidate.id === started.id);
      return item?.state === "complete" || item?.state === "interrupted";
    }
  );
  const completed = completedRows.find((item) => item.id === started.id);
  if (!completed || completed.state !== "complete") {
    throw new Error(`${label} 下载失败：${completed?.error ?? "状态未知"}`);
  }
  const path = await download.path();
  if (!path) throw new Error(`${label} 缺少实际落盘路径。`);
  return { item: completed, filename: requested.filename, content: await readFile(path, "utf8") };
}

async function databaseRows(worker) {
  return worker.evaluate(
    () =>
      new Promise((resolvePromise, reject) => {
        const request = indexedDB.open("webfile-hunter");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["files", "sessions", "texts"], "readonly");
          const filesRequest = transaction.objectStore("files").getAll();
          const sessionsRequest = transaction.objectStore("sessions").getAll();
          const textsRequest = transaction.objectStore("texts").getAll();
          transaction.oncomplete = () =>
            resolvePromise({
              files: filesRequest.result,
              sessions: sessionsRequest.result,
              texts: textsRequest.result
            });
          transaction.onerror = () => reject(transaction.error);
        };
      })
  );
}

async function putDatabaseFile(worker, file) {
  await worker.evaluate(
    (value) =>
      new Promise((resolvePromise, reject) => {
        const request = indexedDB.open("webfile-hunter");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("files", "readwrite");
          transaction.objectStore("files").put(value);
          transaction.oncomplete = () => resolvePromise();
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    file
  );
}

async function putDatabaseSession(worker, session) {
  await worker.evaluate(
    (value) =>
      new Promise((resolvePromise, reject) => {
        const request = indexedDB.open("webfile-hunter");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("sessions", "readwrite");
          transaction.objectStore("sessions").put(value);
          transaction.oncomplete = () => resolvePromise();
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    session
  );
}

try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: edgePath,
    headless: true,
    acceptDownloads: true,
    downloadsPath: downloadsDirectory,
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--no-proxy-server",
      `--host-resolver-rules=MAP wfh.test:80 127.0.0.1:${server.port},MAP fallback.wfh.test:80 127.0.0.1:${server.port},MAP ungranted.wfh.test:80 127.0.0.1:${server.port},MAP cdn.wfh.test:80 127.0.0.1:${server.port}`
    ]
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  const workerUrl = new URL(worker.url());
  const extensionOrigin = `${workerUrl.protocol}//${workerUrl.host}`;

  const fixturePage = await context.newPage();
  watchPage(fixturePage, "fixture");
  await fixturePage.goto(server.origin, { waitUntil: "domcontentloaded" });
  const permissionPage = await context.newPage();
  watchPage(permissionPage, "options");
  await permissionPage.goto(`${extensionOrigin}/options/index.html`, {
    waitUntil: "domcontentloaded"
  });
  const initialSettings = await send(permissionPage, { type: "GET_SETTINGS" });
  await send(permissionPage, {
    type: "SAVE_SETTINGS",
    payload: { settings: { ...initialSettings, language: "zh-CN" } }
  });

  const ungrantedPage = await context.newPage();
  watchPage(ungrantedPage, "ungranted");
  await ungrantedPage.goto(ungrantedOrigin, { waitUntil: "domcontentloaded" });
  const ungrantedSnapshot = await send(permissionPage, { type: "GET_SNAPSHOT" });
  if (
    ungrantedSnapshot.activeTab?.url !== ungrantedPage.url() ||
    ungrantedSnapshot.activeTab?.origin !== ungrantedOrigin
  ) {
    throw new Error(`侧栏无法识别未授权普通网页：${JSON.stringify(ungrantedSnapshot.activeTab)}`);
  }
  await ungrantedPage.close();

  await fixturePage.bringToFront();
  const tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id
  );
  if (tabId === undefined) throw new Error("无法读取 Edge 测试标签页 ID。");

  const currentSession = await send(permissionPage, {
    type: "SCAN_CURRENT_PAGE",
    payload: { tabId }
  });
  const currentRows = await eventually(
    () => databaseRows(worker),
    (rows) =>
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id && file.canonicalUrl.endsWith("/files/sample.txt")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id && file.canonicalUrl.endsWith("/files/example.mp3")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl.endsWith("/files/srcdoc-only.mp3") &&
          file.sourcePageUrl.includes("#webfile-hunter-frame-") &&
          file.parentUrl === `${server.origin}/`
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/api/legacy-player` &&
          file.confidence >= 70
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.warnings.includes("temporary_blob") &&
          file.isDownloadable === false
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/api/structured-video` &&
          file.sources.includes("DOM_ATTRIBUTE")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/api/typed-document` &&
          file.mimeType === "application/pdf"
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/api/podcast` &&
          file.mimeType === "audio/mpeg"
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/api/itemprop-video` &&
          file.confidence === 70 &&
          file.sources.includes("DOM_ATTRIBUTE")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/api/template-document` &&
          file.sources.includes("DOM_ATTRIBUTE")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/files/shadow-video.mp4` &&
          file.sources.includes("DOM_ATTRIBUTE")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/files/lazy-manual.pdf`
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/theme.css` &&
          file.category === "code" &&
          file.sources.includes("CSS_URL")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/files/test-font.woff2` &&
          file.category === "font" &&
          file.sources.includes("CSS_URL")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/files/css-choice.avif` &&
          file.sources.includes("CSS_URL")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/files/theme-background.svg` &&
          file.sources.includes("CSS_URL")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === currentSession.id &&
          file.canonicalUrl === `${server.origin}/files/adopted-initial.webp` &&
          file.sources.includes("CSS_URL")
      ) &&
      rows.texts.some(
        (document) =>
          document.sessionId === currentSession.id &&
          document.content.includes("WebFile Hunter 正文提取夹具 alpha beta beta") &&
          document.content.includes("开放 Shadow 正文") &&
          !document.content.includes("hidden-text-secret") &&
          !document.content.includes("aria-text-secret") &&
          !document.content.includes("display-text-secret") &&
          !document.content.includes("input-text-secret") &&
          !document.content.includes("textarea-text-secret") &&
          !document.content.includes("editable-text-secret")
      ) &&
      rows.texts.some(
        (document) =>
          document.sessionId === currentSession.id &&
          document.pageUrl.includes("#webfile-hunter-frame-") &&
          document.content.includes("srcdoc Frame 公开正文 gamma")
      )
  );
  const currentFiles = currentRows.files.filter((file) => file.sessionId === currentSession.id);
  if (currentFiles.length < 2) throw new Error("当前页面扫描结果不足。");
  const discoveredCodeFile = currentFiles.find(
    (file) => file.canonicalUrl === `${server.origin}/theme.css`
  );
  const discoveredFontFile = currentFiles.find(
    (file) => file.canonicalUrl === `${server.origin}/files/test-font.woff2`
  );
  if (!discoveredCodeFile || !discoveredFontFile) {
    throw new Error("源码或字体分类夹具未被当前页扫描发现。");
  }
  await eventually(
    () => databaseRows(worker),
    (rows) =>
      rows.sessions.find((session) => session.id === currentSession.id)?.status === "completed"
  );

  await fixturePage.evaluate(
    (url) =>
      new Promise((resolvePromise, reject) => {
        const frame = document.createElement("iframe");
        frame.src = url;
        frame.onload = () => resolvePromise();
        frame.onerror = () => reject(new Error("跨域 frame 加载失败"));
        document.body.append(frame);
      }),
    `${cdnOrigin}/cross-frame`
  );
  await fixturePage.evaluate(() => {
    const meta = document.createElement("meta");
    meta.id = "dynamic-og-image";
    meta.setAttribute("property", "og:image");
    meta.content = "";
    document.head.append(meta);
  });

  const liveSettings = await send(permissionPage, { type: "GET_SETTINGS" });
  await send(permissionPage, {
    type: "SAVE_SETTINGS",
    payload: {
      settings: {
        ...liveSettings,
        customExtensions: { ...liveSettings.customExtensions, meshx: "model" }
      }
    }
  });
  const liveSession = await send(permissionPage, {
    type: "START_LIVE_MONITOR",
    payload: { tabId, origin: server.origin }
  });
  await fixturePage.locator("#load-audio").click();
  await fixturePage.locator("#load-api").click();
  await fixturePage.evaluate(() => {
    const host = document.querySelector("#late-shadow-host");
    if (!(host instanceof HTMLElement) || host.shadowRoot) {
      throw new Error("延迟 Shadow Root 宿主状态异常");
    }
    host.attachShadow({ mode: "open" }).innerHTML =
      '<a type="application/pdf" href="/api/late-shadow-document">延迟 Shadow 文档</a>';
  });
  await fixturePage.evaluate(() => {
    const meta = document.querySelector("#dynamic-og-image");
    if (!(meta instanceof HTMLMetaElement)) throw new Error("动态 OG 元信息不存在");
    meta.content = "/files/dynamic-og.webp";
  });
  await fixturePage.evaluate(() => {
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(
      '.live-adopted-fixture { background-image: url("/files/adopted-live.webp"); }'
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, stylesheet];
  });
  await fixturePage.evaluate(
    (url) => fetch(url).then((response) => response.arrayBuffer()),
    `${cdnOrigin}/api/cross-origin`
  );
  await fixturePage.evaluate(
    (url) => fetch(url).then((response) => response.arrayBuffer()),
    `${cdnOrigin}/files/live-scene.meshx`
  );
  const liveRows = await eventually(
    () => databaseRows(worker),
    (rows) =>
      rows.files.some(
        (file) =>
          file.sessionId === liveSession.id &&
          file.filename === "report fixture.txt" &&
          file.sources.includes("NETWORK_HEADER")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === liveSession.id &&
          file.filename === "cross-origin-resource.bin" &&
          file.sources.includes("NETWORK_HEADER")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === liveSession.id &&
          file.canonicalUrl === `${cdnOrigin}/files/frame-video.mp4` &&
          file.parentUrl === `${cdnOrigin}/cross-frame` &&
          file.isExternal === true
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === liveSession.id &&
          file.canonicalUrl === `${server.origin}/files/dynamic-og.webp` &&
          file.sources.includes("DOM_ATTRIBUTE")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === liveSession.id &&
          file.canonicalUrl === `${server.origin}/api/late-shadow-document` &&
          file.mimeType === "application/pdf" &&
          file.sources.includes("DOM_ATTRIBUTE")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === liveSession.id &&
          file.canonicalUrl === `${server.origin}/files/adopted-live.webp` &&
          file.sources.includes("CSS_URL")
      ) &&
      rows.files.some(
        (file) =>
          file.sessionId === liveSession.id &&
          file.canonicalUrl === `${cdnOrigin}/files/live-scene.meshx` &&
          file.category === "model" &&
          file.sources.includes("NETWORK_REQUEST")
      )
  );
  const apiFile = liveRows.files.find(
    (file) => file.sessionId === liveSession.id && file.filename === "report fixture.txt"
  );
  if (apiFile?.mimeType !== "text/plain") throw new Error("无后缀响应未通过 Content-Type 识别。");

  await fixturePage.goto(`${server.origin}/page-2.html`, { waitUntil: "domcontentloaded" });
  await fixturePage.evaluate(() => {
    const link = document.createElement("link");
    link.rel = "preload";
    link.href = "/files/navigation-only.css";
    document.head.append(link);
  });
  await eventually(
    () => databaseRows(worker),
    (rows) =>
      rows.files.some(
        (file) =>
          file.sessionId === liveSession.id &&
          file.canonicalUrl.endsWith("/files/navigation-only.css") &&
          file.sourcePageUrl.endsWith("/page-2.html")
      )
  );
  await send(permissionPage, { type: "STOP_SCAN", payload: { sessionId: liveSession.id } });

  const recursivePage = await context.newPage();
  watchPage(recursivePage, "recursive");
  await recursivePage.goto(recursiveOrigin, { waitUntil: "domcontentloaded" });
  await recursivePage.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/spa-only.html";
    link.textContent = "SPA 运行时页面";
    document.body.append(link);
  });
  const recursiveTabId = await worker.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id
  );
  if (recursiveTabId === undefined) throw new Error("无法读取递归测试标签页 ID。");
  await permissionPage.evaluate(() => {
    globalThis.__wfhScanProgressEvents = [];
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "SCAN_PROGRESS") {
        globalThis.__wfhScanProgressEvents.push(message.payload);
      }
    });
  });
  const settings = await send(permissionPage, { type: "GET_SETTINGS" });
  const recursiveSession = await send(permissionPage, {
    type: "START_RECURSIVE_CRAWL",
    payload: {
      tabId: recursiveTabId,
      config: {
        ...settings.scan,
        maxDepth: 2,
        maxPages: 20,
        maxConcurrency: 2,
        minDelayMs: 500,
        probeMetadata: false
      }
    }
  });
  const runningProgress = await eventually(
    () =>
      permissionPage.evaluate((sessionId) => {
        const events = globalThis.__wfhScanProgressEvents ?? [];
        return events.find(
          (event) =>
            event.sessionId === sessionId &&
            event.status === "running" &&
            event.currentUrl &&
            event.requestsPerMinute >= 1
        );
      }, recursiveSession.id),
    (progress) => Boolean(progress)
  );
  if (!runningProgress.currentUrl.startsWith(recursiveOrigin)) {
    throw new Error(`递归实时进度 URL 不正确：${runningProgress.currentUrl}`);
  }
  const recursiveRows = await eventually(
    () => databaseRows(worker),
    (rows) =>
      rows.sessions.find((session) => session.id === recursiveSession.id)?.status === "completed",
    30_000
  );
  const completedRecursive = recursiveRows.sessions.find(
    (session) => session.id === recursiveSession.id
  );
  const recursiveFiles = recursiveRows.files.filter(
    (file) => file.sessionId === recursiveSession.id
  );
  const recursiveTexts = recursiveRows.texts.filter(
    (document) => document.sessionId === recursiveSession.id
  );
  if (
    !completedRecursive ||
    completedRecursive.pagesProcessed < 5 ||
    !completedRecursive.currentUrl ||
    !completedRecursive.requestsPerMinute ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/files/archive.zip")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/files/sample.txt")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/files/sitemap-only.json")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/files/spa-only.csv")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/api/structured-video")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/api/typed-document")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/api/template-document")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/files/alternate-only.txt")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/files/mapped-only.csv")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/files/header-next.zip")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/files/refresh-only.txt")) ||
    !recursiveFiles.some(
      (file) =>
        file.canonicalUrl.endsWith("/recursive-style") &&
        file.category === "code" &&
        file.mimeType === "text/css"
    ) ||
    !recursiveFiles.some(
      (file) =>
        file.canonicalUrl.endsWith("/files/css-recursive-only.jxl") &&
        file.category === "image" &&
        file.sources.includes("CSS_URL")
    ) ||
    !recursiveFiles.some(
      (file) =>
        file.canonicalUrl.endsWith("/files/recursive-only.woff2") && file.category === "font"
    ) ||
    !recursiveFiles.some(
      (file) =>
        file.canonicalUrl.endsWith("/api/header-document") && file.mimeType === "application/pdf"
    ) ||
    !recursiveFiles.some(
      (file) =>
        file.canonicalUrl.endsWith("/files/shadow-video.mp4") &&
        file.sources.includes("DOM_ATTRIBUTE")
    ) ||
    !recursiveTexts.some((document) => document.content.includes("第一页递归公开正文"))
  ) {
    throw new Error(
      `递归扫描链路不完整：${JSON.stringify({ completedRecursive, files: recursiveFiles.length })}`
    );
  }

  const fallbackPage = await context.newPage();
  watchPage(fallbackPage, "fallback-sitemap");
  await fallbackPage.goto(fallbackOrigin, { waitUntil: "domcontentloaded" });
  const fallbackTabId = await worker.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id
  );
  if (fallbackTabId === undefined) throw new Error("无法读取默认 Sitemap 测试标签页 ID。");
  const fallbackSession = await send(permissionPage, {
    type: "START_RECURSIVE_CRAWL",
    payload: {
      tabId: fallbackTabId,
      config: {
        ...settings.scan,
        respectRobots: true,
        maxDepth: 0,
        maxPages: 4,
        maxConcurrency: 2,
        minDelayMs: 500,
        probeMetadata: false
      }
    }
  });
  const fallbackRows = await eventually(
    () => databaseRows(worker),
    (rows) =>
      rows.sessions.find((session) => session.id === fallbackSession.id)?.status === "completed",
    20_000
  );
  if (
    !fallbackRows.files.some(
      (file) =>
        file.sessionId === fallbackSession.id &&
        file.canonicalUrl === `${fallbackOrigin}/files/fallback-only.json`
    )
  ) {
    throw new Error("robots 未声明 Sitemap 时未从标准压缩入口发现公开资源。");
  }
  await fallbackPage.close();

  const recursiveDownloadFile = recursiveFiles.find((file) =>
    file.canonicalUrl.endsWith("/files/sample.txt")
  );
  if (!recursiveDownloadFile) throw new Error("递归扫描未生成可下载的文本夹具。");
  const downloadableFile = {
    ...recursiveDownloadFile,
    id: "file-e2e-download",
    sessionId: liveSession.id,
    discoveredAt: Date.now(),
    updatedAt: Date.now()
  };
  await putDatabaseFile(worker, downloadableFile);
  const queuedSentinelFile = {
    ...downloadableFile,
    id: "file-e2e-queued-sentinel",
    originalUrl: `${recursiveOrigin}/files/sample.txt?queued-sentinel=1`,
    canonicalUrl: `${recursiveOrigin}/files/sample.txt?queued-sentinel=1`,
    finalUrl: `${recursiveOrigin}/files/sample.txt?queued-sentinel=1`,
    filename: "queued-sentinel.txt",
    discoveredAt: Date.now() + 1,
    updatedAt: Date.now() + 1
  };
  await putDatabaseFile(worker, queuedSentinelFile);
  const previewImageFile = {
    ...currentFiles[0],
    id: "file-e2e-preview-image",
    sessionId: liveSession.id,
    originalUrl: `${recursiveOrigin}/files/pixel.png`,
    canonicalUrl: `${recursiveOrigin}/files/pixel.png`,
    finalUrl: `${recursiveOrigin}/files/pixel.png`,
    sourcePageUrl: recursiveOrigin,
    filename: "preview-image.png",
    extension: "png",
    category: "image",
    mimeType: "image/png",
    confidence: 100,
    isExternal: true,
    isDownloadable: true,
    warnings: [],
    discoveredAt: Date.now() + 2,
    updatedAt: Date.now() + 2
  };
  await putDatabaseFile(worker, previewImageFile);
  const previewAudioFile = {
    ...currentFiles[0],
    id: "file-e2e-preview-audio",
    sessionId: liveSession.id,
    originalUrl: `${recursiveOrigin}/files/preview.wav`,
    canonicalUrl: `${recursiveOrigin}/files/preview.wav`,
    finalUrl: `${recursiveOrigin}/files/preview.wav`,
    sourcePageUrl: recursiveOrigin,
    filename: "preview-audio.wav",
    extension: "wav",
    category: "audio",
    mimeType: "audio/wav",
    confidence: 100,
    isExternal: true,
    isDownloadable: true,
    warnings: [],
    discoveredAt: Date.now() + 3,
    updatedAt: Date.now() + 3
  };
  await putDatabaseFile(worker, previewAudioFile);
  const codeFile = {
    ...discoveredCodeFile,
    id: "file-e2e-code",
    sessionId: liveSession.id,
    originalUrl: `${discoveredCodeFile.originalUrl}?e2e-category=code`,
    canonicalUrl: `${discoveredCodeFile.canonicalUrl}?e2e-category=code`,
    finalUrl: `${discoveredCodeFile.canonicalUrl}?e2e-category=code`,
    filename: "classified-code.css",
    discoveredAt: Date.now() + 4,
    updatedAt: Date.now() + 4
  };
  const fontFile = {
    ...discoveredFontFile,
    id: "file-e2e-font",
    sessionId: liveSession.id,
    originalUrl: `${discoveredFontFile.originalUrl}?e2e-category=font`,
    canonicalUrl: `${discoveredFontFile.canonicalUrl}?e2e-category=font`,
    finalUrl: `${discoveredFontFile.canonicalUrl}?e2e-category=font`,
    filename: "classified-font.woff2",
    discoveredAt: Date.now() + 5,
    updatedAt: Date.now() + 5
  };
  const modelFile = {
    ...currentFiles[0],
    id: "file-e2e-model",
    sessionId: liveSession.id,
    originalUrl: `${server.origin}/files/scene.glb`,
    canonicalUrl: `${server.origin}/files/scene.glb`,
    finalUrl: `${server.origin}/files/scene.glb`,
    filename: "classified-model.glb",
    extension: "glb",
    category: "model",
    mimeType: "model/gltf-binary",
    confidence: 100,
    discoveredAt: Date.now() + 6,
    updatedAt: Date.now() + 6
  };
  await putDatabaseFile(worker, codeFile);
  await putDatabaseFile(worker, fontFile);
  await putDatabaseFile(worker, modelFile);
  const metadataRetryFile = {
    ...currentFiles[0],
    id: "file-e2e-metadata-retry",
    sessionId: liveSession.id,
    originalUrl: `${recursiveOrigin}/slow-page?metadata-retry=1`,
    canonicalUrl: `${recursiveOrigin}/slow-page?metadata-retry=1`,
    filename: "metadata-retry.pdf",
    extension: "pdf",
    category: "document",
    mimeType: "application/pdf",
    confidence: 100,
    metadataStatus: "complete",
    discoveredAt: Date.now() + 7,
    updatedAt: Date.now() + 7
  };
  await putDatabaseFile(worker, metadataRetryFile);
  const metadataRetry = send(permissionPage, {
    type: "PROBE_METADATA",
    payload: { sessionId: liveSession.id, candidateId: metadataRetryFile.id }
  });
  await eventually(
    () => databaseRows(worker),
    (rows) =>
      rows.files.find((file) => file.id === metadataRetryFile.id)?.metadataStatus === "pending"
  );
  await metadataRetry;
  const metadataRetryRows = await databaseRows(worker);
  if (
    metadataRetryRows.files.find((file) => file.id === metadataRetryFile.id)?.metadataStatus !==
    "complete"
  ) {
    throw new Error("元数据重新探测未从 pending 正确完成。");
  }

  const extremeFilename = `${"超长文件名-".repeat(12)}fixture.extremelylongextension`;
  await putDatabaseFile(worker, {
    ...currentFiles[0],
    id: "file-e2e-extreme",
    sessionId: liveSession.id,
    originalUrl: `${server.origin}/files/${encodeURIComponent(extremeFilename)}`,
    canonicalUrl: `${server.origin}/files/${encodeURIComponent(extremeFilename)}`,
    filename: extremeFilename,
    extension: "extremelylongextension",
    category: "audio",
    mimeType: `application/vnd.${"very-long-vendor-tree-".repeat(8)}fixture+json`,
    confidence: 100,
    sources: [
      "DOM_ATTRIBUTE",
      "DOWNLOAD_ATTRIBUTE",
      "CSS_URL",
      "PERFORMANCE_ENTRY",
      "NETWORK_REQUEST",
      "NETWORK_HEADER",
      "CRAWLED_PAGE",
      "MANUAL_URL"
    ],
    warnings: ["temporary_url", "temporary_blob", "segmented_stream", "mime_extension_conflict"],
    discoveredAt: Date.now(),
    updatedAt: Date.now()
  });
  const rowsWithExtreme = await databaseRows(worker);
  if (
    !rowsWithExtreme.files.some(
      (file) => file.id === "file-e2e-extreme" && file.sessionId === liveSession.id
    ) ||
    !rowsWithExtreme.files.some(
      (file) => file.id === downloadableFile.id && file.sessionId === liveSession.id
    ) ||
    !rowsWithExtreme.files.some(
      (file) => file.id === previewImageFile.id && file.sessionId === liveSession.id
    ) ||
    !rowsWithExtreme.files.some(
      (file) => file.id === previewAudioFile.id && file.sessionId === liveSession.id
    ) ||
    !rowsWithExtreme.files.some(
      (file) => file.id === codeFile.id && file.sessionId === liveSession.id
    ) ||
    !rowsWithExtreme.files.some(
      (file) => file.id === fontFile.id && file.sessionId === liveSession.id
    ) ||
    !rowsWithExtreme.files.some(
      (file) => file.id === modelFile.id && file.sessionId === liveSession.id
    ) ||
    !rowsWithExtreme.files.some(
      (file) => file.id === metadataRetryFile.id && file.sessionId === liveSession.id
    )
  ) {
    throw new Error("结果页 E2E 夹具未写入实时监听会话。");
  }
  const storedLiveSession = rowsWithExtreme.sessions.find(
    (session) => session.id === liveSession.id
  );
  if (!storedLiveSession) throw new Error("实时监听会话记录不存在。");
  await putDatabaseSession(worker, {
    ...storedLiveSession,
    filesDiscovered: rowsWithExtreme.files.filter((file) => file.sessionId === liveSession.id)
      .length
  });

  const sidepanelPage = await context.newPage();
  const mediaRequestReferrers = [];
  sidepanelPage.on("request", (request) => {
    if (/\/files\/preview\.(?:png|wav)$/.test(new URL(request.url()).pathname)) {
      mediaRequestReferrers.push({ url: request.url(), referrer: request.headers().referer });
    }
  });
  watchPage(sidepanelPage, "sidepanel");
  await sidepanelPage.setViewportSize({ width: 380, height: 820 });
  await sidepanelPage.goto(`${extensionOrigin}/sidepanel/index.html`, {
    waitUntil: "domcontentloaded"
  });
  const referrerPolicy = await sidepanelPage
    .locator('meta[name="referrer"]')
    .getAttribute("content");
  if (referrerPolicy !== "no-referrer") {
    throw new Error(`侧栏媒体来源策略不安全：${referrerPolicy || "未设置"}`);
  }
  await sidepanelPage.getByRole("heading", { name: "WebFile Hunter" }).waitFor();
  await sidepanelPage.getByRole("heading", { name: "开始扫描" }).waitFor();
  const currentSite = sidepanelPage.locator(".app-header p");
  await fixturePage.bringToFront();
  await eventually(
    () => currentSite.getAttribute("title"),
    (title) => title === fixturePage.url()
  );
  for (const name of ["扫描当前页面", "开始完整嗅探", "同域递归扫描"]) {
    if (await sidepanelPage.getByRole("button", { name: new RegExp(name) }).isDisabled()) {
      throw new Error(`普通网页扫描入口被意外禁用：${name}`);
    }
  }
  await assertResponsive(sidepanelPage, "扫描页");
  await assertMotionAndFocusAccessibility(sidepanelPage);
  await assertActiveNavigation(sidepanelPage, "扫描");
  await mkdir(resolve("test-results"), { recursive: true });
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-scan-380.png"),
    fullPage: true
  });

  await fixturePage.goto(server.origin, { waitUntil: "domcontentloaded" });
  await eventually(
    () => currentSite.getAttribute("title"),
    (title) => title === fixturePage.url()
  );
  const alternatePage = await context.newPage();
  watchPage(alternatePage, "alternate");
  await alternatePage.goto(`${server.origin}/page-2.html?tab=alternate`, {
    waitUntil: "domcontentloaded"
  });
  await eventually(
    () => currentSite.getAttribute("title"),
    (title) => title === alternatePage.url()
  );
  await fixturePage.bringToFront();
  await eventually(
    () => currentSite.getAttribute("title"),
    (title) => title === fixturePage.url()
  );

  await sidepanelPage.getByRole("button", { name: "历史", exact: true }).click();
  const currentHistoryCard = sidepanelPage
    .locator(".history-card")
    .filter({ hasText: "当前页" })
    .first();
  await currentHistoryCard.getByRole("button", { name: "查看文字" }).click();
  await sidepanelPage.getByRole("heading", { name: "网页文字" }).waitFor();
  await sidepanelPage
    .getByRole("combobox", { name: "选择网页" })
    .selectOption({ label: "WebFile Hunter 演示站" });
  await sidepanelPage
    .getByText("WebFile Hunter 正文提取夹具 alpha beta beta", {
      exact: false
    })
    .waitFor();
  if (
    await sidepanelPage
      .getByText(/(?:hidden|aria|display|input|textarea|editable)-text-secret/)
      .count()
  ) {
    throw new Error("文字页泄露隐藏内容、表单值或可编辑草稿。");
  }
  await sidepanelPage.getByRole("searchbox", { name: "搜索当前文字" }).fill("beta");
  await sidepanelPage.getByText("2 处匹配", { exact: true }).waitFor();
  await sidepanelPage.getByRole("button", { name: "复制当前", exact: true }).click();
  await sidepanelPage.getByText("已复制当前网页文字。", { exact: true }).waitFor();
  const exportedPageText = await captureDownload(
    sidepanelPage,
    worker,
    () => sidepanelPage.getByRole("button", { name: "导出 TXT", exact: true }).click(),
    (filename) => /webfile-hunter-text-127\.0\.0\.1-.*\.txt$/.test(filename),
    "网页文字导出"
  );
  if (
    !exportedPageText.content.includes("WebFile Hunter 正文提取夹具") ||
    exportedPageText.content.includes("input-text-secret")
  ) {
    throw new Error("网页文字导出内容或隐私过滤不正确。");
  }
  await assertResponsive(sidepanelPage, "文字页");
  await assertActiveNavigation(sidepanelPage, "文本");
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-text-380.png"),
    fullPage: true
  });
  await sidepanelPage.getByRole("button", { name: "历史", exact: true }).click();
  await currentHistoryCard.getByRole("button", { name: "打开结果" }).click();
  await sidepanelPage.getByRole("button", { name: "可能资源", exact: true }).click();
  await sidepanelPage.getByText("临时浏览器资源，不能直接下载", { exact: true }).waitFor();
  await assertResponsive(sidepanelPage, "可能资源结果页");
  await sidepanelPage.getByRole("button", { name: "历史", exact: true }).click();
  const liveHistoryCard = sidepanelPage
    .locator(".history-card")
    .filter({ hasText: "实时监听" })
    .first();
  await liveHistoryCard.getByRole("button", { name: "打开结果" }).click();
  await sidepanelPage.getByRole("heading", { name: /发现结果/ }).waitFor();
  await assertResponsive(sidepanelPage, "结果页");
  await assertActiveNavigation(sidepanelPage, "结果");
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-results-380.png"),
    fullPage: true
  });
  await assertResultCardControls(sidepanelPage, extremeFilename, 7);
  await assertLastResultUnobscured(sidepanelPage);

  const resultLanguageSettings = await send(permissionPage, { type: "GET_SETTINGS" });
  await send(permissionPage, {
    type: "SAVE_SETTINGS",
    payload: { settings: { ...resultLanguageSettings, language: "en" } }
  });
  await sidepanelPage.getByRole("heading", { name: /Discovered results/ }).waitFor();
  await sidepanelPage
    .getByRole("searchbox", { name: "Search results" })
    .fill(previewImageFile.filename);
  await assertResultCardControls(sidepanelPage, previewImageFile.filename, 7);
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-results-en-380.png"),
    fullPage: true
  });
  await send(permissionPage, {
    type: "SAVE_SETTINGS",
    payload: { settings: { ...resultLanguageSettings, language: "zh-CN" } }
  });
  await sidepanelPage.getByRole("heading", { name: /发现结果/ }).waitFor();
  await sidepanelPage.getByRole("searchbox", { name: "搜索结果" }).fill("");

  await sidepanelPage.getByRole("button", { name: "源码", exact: true }).click();
  const codeCard = sidepanelPage.locator(".result-card").filter({
    has: sidepanelPage.getByTitle(codeFile.filename, { exact: true })
  });
  await codeCard.locator(".file-type.type-code").waitFor();
  await assertResultCardControls(sidepanelPage, codeFile.filename, 6);
  await sidepanelPage.getByRole("button", { name: "字体", exact: true }).click();
  const fontCard = sidepanelPage.locator(".result-card").filter({
    has: sidepanelPage.getByTitle(fontFile.filename, { exact: true })
  });
  await fontCard.locator(".file-type.type-font").waitFor();
  await assertResultCardControls(sidepanelPage, fontFile.filename, 6);
  await sidepanelPage.getByRole("button", { name: "3D 模型", exact: true }).click();
  const modelCard = sidepanelPage.locator(".result-card").filter({
    has: sidepanelPage.getByTitle(modelFile.filename, { exact: true })
  });
  await modelCard.locator(".file-type.type-model").waitFor();
  await assertResultCardControls(sidepanelPage, modelFile.filename, 6);
  await sidepanelPage.getByRole("button", { name: "全部", exact: true }).click();

  const resultSearch = sidepanelPage.getByRole("searchbox", { name: "搜索结果" });
  await resultSearch.fill("  ＰＮＧ   preview  ");
  await sidepanelPage.getByText("找到 1 项；多个关键词需全部匹配", { exact: true }).waitFor();
  const imageCard = sidepanelPage.locator(".result-card").filter({
    has: sidepanelPage.getByTitle(previewImageFile.canonicalUrl, { exact: true })
  });
  const imageThumbnail = imageCard.getByRole("img", {
    name: `缩略图：${previewImageFile.filename}`
  });
  await eventually(
    () =>
      imageThumbnail.evaluate((image) => ({
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight
      })),
    (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
  );
  await assertResultCardControls(sidepanelPage, previewImageFile.filename, 7);
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-image-card-380.png"),
    fullPage: true
  });
  const imageThumbnailButton = imageCard.getByRole("button", {
    name: `放大预览：${previewImageFile.filename}`
  });
  await imageThumbnailButton.click();
  const imageDialog = sidepanelPage.getByRole("dialog", {
    name: `图片预览：${previewImageFile.filename}`
  });
  await imageDialog.waitFor();
  await eventually(
    () =>
      imageDialog.locator("img").evaluate((image) => ({
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight
      })),
    (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
  );
  await assertResponsive(sidepanelPage, "图片预览");
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-image-preview-380.png"),
    fullPage: true
  });
  await sidepanelPage.keyboard.press("Escape");
  await imageDialog.waitFor({ state: "detached" });
  if (!(await imageThumbnailButton.evaluate((button) => button === document.activeElement))) {
    throw new Error("关闭图片预览后焦点未返回缩略图按钮。");
  }

  const detailsTrigger = imageCard.getByRole("button", { name: "详情", exact: true });
  await detailsTrigger.click();
  const detailsDialog = sidepanelPage.getByRole("dialog", {
    name: `文件详情：${previewImageFile.filename}`
  });
  await detailsDialog.waitFor();
  if (
    !(await sidepanelPage
      .locator(".section-heading")
      .evaluate((element) => element.hasAttribute("inert")))
  ) {
    throw new Error("文件详情打开时背景未进入 inert 状态。");
  }
  await detailsDialog.getByText(previewImageFile.canonicalUrl, { exact: true }).waitFor();
  for (const name of ["复制文件名", "复制 Markdown", "复制元数据 JSON", "打开资源", "打开来源页"]) {
    await detailsDialog.getByRole("button", { name, exact: true }).waitFor();
  }
  await assertResponsive(sidepanelPage, "文件详情");
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-details-380.png"),
    fullPage: true
  });
  await sidepanelPage.keyboard.press("Shift+Tab");
  if (
    !(await detailsDialog
      .getByRole("button", { name: "打开来源页", exact: true })
      .evaluate((button) => button === document.activeElement))
  ) {
    throw new Error("文件详情焦点闭环未从首项回到末项。");
  }
  await sidepanelPage.keyboard.press("Tab");
  await detailsDialog.getByRole("button", { name: "复制文件名", exact: true }).click();
  await detailsDialog.getByText("文件名已复制。", { exact: true }).waitFor();
  await sidepanelPage.keyboard.press("Escape");
  await detailsDialog.waitFor({ state: "detached" });
  if (!(await detailsTrigger.evaluate((button) => button === document.activeElement))) {
    throw new Error("关闭文件详情后焦点未返回详情按钮。");
  }

  await sidepanelPage.getByRole("button", { name: "重置筛选", exact: true }).click();
  if ((await resultSearch.inputValue()) !== "") throw new Error("重置筛选未清空搜索条件。");
  if (await sidepanelPage.getByRole("button", { name: "重置筛选", exact: true }).count()) {
    throw new Error("重置筛选后仍错误显示活动筛选状态。");
  }

  await resultSearch.fill(previewAudioFile.filename);
  const audioCard = sidepanelPage.locator(".result-card").filter({
    has: sidepanelPage.getByTitle(previewAudioFile.canonicalUrl, { exact: true })
  });
  const inlineAudio = audioCard.locator("audio");
  await eventually(
    () =>
      inlineAudio.evaluate((audio) => ({
        autoplay: audio.autoplay,
        duration: audio.duration,
        error: audio.error?.code,
        paused: audio.paused,
        readyState: audio.readyState
      })),
    (state) => state.readyState >= 1 && Number.isFinite(state.duration)
  );
  await audioCard.getByText("0:01", { exact: true }).waitFor();
  const inlinePlay = audioCard.getByRole("button", {
    name: `播放音频：${previewAudioFile.filename}`
  });
  await inlinePlay.click();
  await eventually(
    () => inlineAudio.evaluate((audio) => audio.paused),
    (paused) => paused === false
  );
  const inlinePause = audioCard.getByRole("button", {
    name: `暂停音频：${previewAudioFile.filename}`
  });
  await inlinePause.click();
  await eventually(
    () => inlineAudio.evaluate((audio) => audio.paused),
    (paused) => paused === true
  );
  await audioCard.getByRole("button", { name: "试听", exact: true }).click();
  const audioDialog = sidepanelPage.getByRole("dialog", {
    name: `音频试听：${previewAudioFile.filename}`
  });
  const audioPlayer = audioDialog.locator("audio");
  const audioState = await eventually(
    () =>
      audioPlayer.evaluate((audio) => ({
        autoplay: audio.autoplay,
        controls: audio.controls,
        duration: audio.duration,
        error: audio.error?.code,
        paused: audio.paused,
        readyState: audio.readyState
      })),
    (state) => state.readyState >= 1 && Number.isFinite(state.duration)
  );
  if (
    audioState.autoplay ||
    !audioState.controls ||
    !audioState.paused ||
    audioState.error ||
    audioState.duration <= 0
  ) {
    throw new Error(`音频试听状态异常：${JSON.stringify(audioState)}`);
  }
  await assertResponsive(sidepanelPage, "音频试听");
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-audio-preview-380.png"),
    fullPage: true
  });
  await sidepanelPage.keyboard.press("Escape");
  await audioDialog.waitFor({ state: "detached" });
  if (
    mediaRequestReferrers.length === 0 ||
    mediaRequestReferrers.some((request) => request.referrer)
  ) {
    throw new Error(`媒体请求来源策略异常：${JSON.stringify(mediaRequestReferrers)}`);
  }

  await resultSearch.fill(downloadableFile.filename);
  const downloadableCard = sidepanelPage.locator(".result-card").filter({
    has: sidepanelPage.getByTitle(downloadableFile.canonicalUrl, { exact: true })
  });
  await downloadableCard
    .getByRole("checkbox", { name: `选择 ${downloadableFile.filename}`, exact: true })
    .click();
  const exportedTxt = await captureDownload(
    sidepanelPage,
    worker,
    () => sidepanelPage.getByRole("button", { name: "TXT", exact: true }).click(),
    (filename) => /webfile-hunter-\d{4}-\d{2}-\d{2}\.txt$/.test(filename),
    "TXT 结果导出"
  );
  if (!exportedTxt.content.includes(downloadableFile.canonicalUrl)) {
    throw new Error("TXT 结果导出内容缺少已选文件 URL。");
  }
  const exportedCsv = await captureDownload(
    sidepanelPage,
    worker,
    () => sidepanelPage.getByRole("button", { name: "CSV", exact: true }).click(),
    (filename) => /webfile-hunter-\d{4}-\d{2}-\d{2}\.csv$/.test(filename),
    "CSV 结果导出"
  );
  if (
    !exportedCsv.content.startsWith("\uFEFFfilename,url,") ||
    !exportedCsv.content.includes(downloadableFile.filename)
  ) {
    throw new Error("CSV 结果导出内容或 UTF-8 BOM 不正确。");
  }
  const exportedJson = await captureDownload(
    sidepanelPage,
    worker,
    () => sidepanelPage.getByRole("button", { name: "JSON", exact: true }).click(),
    (filename) => /webfile-hunter-\d{4}-\d{2}-\d{2}\.json$/.test(filename),
    "JSON 结果导出"
  );
  const exportedJsonData = JSON.parse(exportedJson.content);
  if (
    exportedJsonData.exportVersion !== 1 ||
    exportedJsonData.files?.length !== 1 ||
    exportedJsonData.files[0]?.id !== downloadableFile.id
  ) {
    throw new Error("JSON 结果导出结构或已选文件范围不正确。");
  }

  const [sentinelTask] = await send(permissionPage, {
    type: "QUEUE_DOWNLOADS",
    payload: { candidateIds: [queuedSentinelFile.id] }
  });
  if (!sentinelTask) throw new Error("单项下载隔离哨兵未加入队列。");
  const fileRequestIndex = await prepareDownloadCapture(worker);
  sidepanelPage.once("dialog", (dialog) => void dialog.accept());
  await downloadableCard.getByRole("button", { name: "下载", exact: true }).click();
  const requestedFileDownload = await capturedDownloadRequest(worker, fileRequestIndex);
  const completedDownloads = await eventually(
    () => send(permissionPage, { type: "GET_DOWNLOADS" }),
    (downloads) =>
      downloads.some(
        (task) => task.candidateId === downloadableFile.id && task.status === "completed"
      )
  );
  const completedTask = completedDownloads.find((task) => task.candidateId === downloadableFile.id);
  if (
    completedDownloads.find((task) => task.id === sentinelTask.id)?.status !== "queued" ||
    completedTask?.browserDownloadId === undefined
  ) {
    throw new Error("单项下载误启动了其他队列任务，或自身未完成。");
  }

  await resultSearch.fill(previewImageFile.filename);
  const openedPagePromise = context.waitForEvent("page");
  await imageCard.getByRole("button", { name: "打开", exact: true }).click();
  const openedResourcePage = await openedPagePromise;
  await openedResourcePage.waitForLoadState("domcontentloaded");
  if (openedResourcePage.url() !== previewImageFile.canonicalUrl) {
    throw new Error(`打开按钮未在新标签页打开资源：${openedResourcePage.url()}`);
  }
  await openedResourcePage.close();

  await sidepanelPage.locator(".tabs").getByRole("button", { name: /下载/ }).click();
  await sidepanelPage.getByRole("heading", { name: "下载队列" }).waitFor();
  await assertResponsive(sidepanelPage, "下载页");
  await assertActiveNavigation(sidepanelPage, "下载");
  const [browserTask] = await worker.evaluate(
    (id) => chrome.downloads.search({ id }),
    completedTask.browserDownloadId
  );
  if (browserTask?.state !== "complete") throw new Error("Edge 未将下载标记为完成。");
  if (requestedFileDownload?.filename !== completedTask.filename) {
    throw new Error(`真实下载文件名不正确：${requestedFileDownload?.filename ?? "未提交文件名"}`);
  }
  const downloadedContent = await readFile(browserTask.filename, "utf8");
  if (downloadedContent !== "WebFile Hunter 本地测试文本。\n") {
    throw new Error("真实下载文件内容不正确。");
  }
  await sidepanelPage
    .locator(".download-card")
    .filter({ hasText: completedTask.filename })
    .getByText("已完成", { exact: true })
    .waitFor();
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-downloads-380.png"),
    fullPage: true
  });

  await sidepanelPage.getByRole("button", { name: "历史", exact: true }).click();
  await sidepanelPage.getByRole("heading", { name: "扫描历史" }).waitFor();
  await assertResponsive(sidepanelPage, "历史页");
  await assertActiveNavigation(sidepanelPage, "历史");
  await sidepanelPage.getByRole("button", { name: "清空历史" }).waitFor();
  const exportedHistory = await captureDownload(
    sidepanelPage,
    worker,
    () => liveHistoryCard.getByRole("button", { name: "导出", exact: true }).click(),
    (filename) => /webfile-hunter-127\.0\.0\.1-.*\.csv$/.test(filename),
    "历史任务导出"
  );
  if (!exportedHistory.content.includes(downloadableFile.canonicalUrl)) {
    throw new Error("历史任务导出缺少对应会话文件。");
  }
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-history-380.png"),
    fullPage: true
  });

  await sidepanelPage.getByRole("button", { name: "设置", exact: true }).click();
  await sidepanelPage.getByRole("heading", { name: "设置", exact: true }).waitFor();
  await assertResponsive(sidepanelPage, "设置页");
  await assertActiveNavigation(sidepanelPage, "设置");
  const currentSiteToggle = sidepanelPage.getByRole("checkbox", {
    name: "自动识别当前网站",
    exact: true
  });
  if (!(await currentSiteToggle.isChecked())) throw new Error("设置页未默认识别当前网站。");
  await sidepanelPage.locator(".permission-editor .current-url").getByText(server.origin).waitFor();
  await currentSiteToggle.uncheck();
  const customSiteInput = sidepanelPage.getByRole("textbox", { name: "网站 URL", exact: true });
  await customSiteInput.fill("not a host");
  await sidepanelPage.getByRole("button", { name: "授权网站", exact: true }).click();
  await sidepanelPage.getByText("请输入有效的 HTTP(S) 网站地址。", { exact: true }).waitFor();
  await customSiteInput.fill("google.com");
  await sidepanelPage.getByRole("button", { name: "授权网站", exact: true }).click();
  await sidepanelPage
    .getByText("网站已获授权，可在对应标签页主动开始扫描。", { exact: true })
    .waitFor();
  if (await sidepanelPage.getByText("https://google.com/*", { exact: true }).count()) {
    throw new Error("完整权限覆盖时错误显示了虚假单站权限。");
  }
  await assertResponsive(sidepanelPage, "自定义网站授权");
  await sidepanelPage.getByLabel("同路径查询变体上限").fill("9");
  await sidepanelPage.getByLabel("样式表抓取上限").fill("160");
  await sidepanelPage.getByLabel("请求超时（秒）").fill("30");
  await sidepanelPage.getByLabel("最大重定向").fill("2");
  await sidepanelPage.getByRole("checkbox", { name: "发现 Sitemap", exact: true }).uncheck();
  await sidepanelPage.getByRole("checkbox", { name: "提取网页文字", exact: true }).uncheck();
  await sidepanelPage.getByRole("checkbox", { name: "跟随重定向", exact: true }).uncheck();
  await sidepanelPage.getByRole("button", { name: "保存", exact: true }).click();
  await sidepanelPage.getByText("设置已保存到本地浏览器。", { exact: true }).waitFor();
  const advancedSettings = await send(permissionPage, { type: "GET_SETTINGS" });
  if (
    advancedSettings.scan.maxQueryVariantsPerPath !== 9 ||
    advancedSettings.scan.maxStylesheets !== 160 ||
    advancedSettings.scan.requestTimeoutMs !== 30_000 ||
    advancedSettings.scan.maxRedirects !== 2 ||
    advancedSettings.scan.discoverSitemaps ||
    advancedSettings.scan.capturePageText ||
    advancedSettings.scan.followRedirects
  ) {
    throw new Error(`高级扫描设置未正确保存：${JSON.stringify(advancedSettings.scan)}`);
  }
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-settings-380.png"),
    fullPage: true
  });

  await sidepanelPage.getByRole("combobox", { name: "界面语言", exact: true }).selectOption("en");
  await sidepanelPage.getByRole("button", { name: "Save", exact: true }).click();
  await sidepanelPage.getByText("Settings saved in this browser.", { exact: true }).waitFor();
  await assertResponsive(sidepanelPage, "English settings page");
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-settings-en-380.png"),
    fullPage: true
  });
  await sidepanelPage
    .locator(".tabs")
    .getByRole("button", { name: "Results", exact: true })
    .click();
  await sidepanelPage.getByRole("heading", { name: /Discovered results/ }).waitFor();
  await assertResponsive(sidepanelPage, "English results page");
  await sidepanelPage.locator(".tabs").getByRole("button", { name: "Text", exact: true }).click();
  await sidepanelPage.getByRole("heading", { name: "Page text", exact: true }).waitFor();
  await assertResponsive(sidepanelPage, "English text page");
  await sidepanelPage
    .locator(".tabs")
    .getByRole("button", { name: /Downloads/, exact: true })
    .click();
  await sidepanelPage.getByRole("heading", { name: "Download queue", exact: true }).waitFor();
  await assertResponsive(sidepanelPage, "English downloads page");
  await sidepanelPage
    .locator(".tabs")
    .getByRole("button", { name: "History", exact: true })
    .click();
  await sidepanelPage.getByRole("heading", { name: "Scan history", exact: true }).waitFor();
  await assertResponsive(sidepanelPage, "English history page");
  await sidepanelPage.locator(".tabs").getByRole("button", { name: "Scan", exact: true }).click();
  await sidepanelPage.getByRole("heading", { name: "Start scanning", exact: true }).waitFor();
  await assertResponsive(sidepanelPage, "English scan page");
  await sidepanelPage
    .locator(".tabs")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await sidepanelPage
    .getByRole("combobox", { name: "Interface language", exact: true })
    .selectOption("zh-CN");
  await sidepanelPage.getByRole("button", { name: "保存", exact: true }).click();
  await sidepanelPage.getByText("设置已保存到本地浏览器。", { exact: true }).waitFor();

  const settingsBeforeClear = await send(permissionPage, { type: "GET_SETTINGS" });
  await sidepanelPage.getByRole("button", { name: "历史", exact: true }).click();
  sidepanelPage.once("dialog", (dialog) => void dialog.accept());
  await sidepanelPage.getByRole("button", { name: "清空历史", exact: true }).click();
  await sidepanelPage.getByText("暂无扫描历史。", { exact: true }).waitFor();
  await eventually(
    () => databaseRows(worker),
    (rows) => rows.sessions.length === 0 && rows.files.length === 0 && rows.texts.length === 0
  );
  const downloadsAfterClear = await send(permissionPage, { type: "GET_DOWNLOADS" });
  const settingsAfterClear = await send(permissionPage, { type: "GET_SETTINGS" });
  if (!downloadsAfterClear.some((task) => task.id === completedTask.id)) {
    throw new Error("清空历史时误删了下载记录。");
  }
  if (JSON.stringify(settingsAfterClear) !== JSON.stringify(settingsBeforeClear)) {
    throw new Error("清空历史时误改了用户设置。");
  }

  if (browserErrors.length) throw new Error(`浏览器页面错误：\n${browserErrors.join("\n")}`);

  console.log(`Edge MV3 加载通过：${extensionOrigin}`);
  console.log("侧栏独立打开时可识别普通 HTTP/HTTPS 网页");
  console.log(`当前页扫描通过：${currentFiles.length} 个候选`);
  console.log("JSON-LD、显式 MIME、itemprop 与 enclosure 资源发现通过");
  console.log("template、开放 Shadow DOM 与延迟 attachShadow 资源发现通过");
  console.log("当前页、开放 Shadow DOM、跨域 Frame 与递归网页文字提取通过");
  console.log("隐藏内容、表单值与可编辑草稿隐私过滤通过");
  console.log("blob 临时媒体安全标记通过");
  console.log(`实时监听通过：${apiFile.filename} (${apiFile.mimeType})`);
  console.log("第三方 CDN 响应与跨域 frame 资源嗅探通过");
  console.log("自定义扩展网络嗅探与元数据重新探测状态流转通过");
  console.log("SPA 既有 Open Graph 元信息动态更新嗅探通过");
  console.log("同源导航监听重注入通过");
  console.log(
    `同源 BFS 递归扫描通过：${completedRecursive.pagesProcessed} 页，${recursiveFiles.length} 个候选`
  );
  console.log("Sitemap Index、raw gzip 隐藏页面、拒绝 HEAD 页面与 SPA 运行时路由抓取通过");
  console.log(
    `递归实时进度通过：${runningProgress.currentUrl}，${runningProgress.requestsPerMinute} 次/分钟`
  );
  console.log("活动标签页切换与导航上下文同步通过");
  console.log("TXT/CSV/JSON 结果导出与历史导出真实落盘通过");
  console.log("结果卡图片缩略图、音频播放暂停与时长显示通过");
  console.log("源码/字体/3D 模型分类、分类计数、文件详情与焦点闭环通过");
  console.log("搜索归一化、多关键词完整匹配与筛选重置通过");
  console.log("递归无扩展样式表、CSS @import 图片与字体发现通过");
  console.log("媒体浮层实际加载且默认不自动播放通过");
  console.log("资源新标签页打开通过");
  console.log("高级扫描设置保存与回读通过");
  console.log("自定义网站授权、输入校验与真实权限回读通过");
  console.log(`单项下载隔离与真实落盘通过：${requestedFileDownload.filename}`);
  console.log("可能资源独立入口与 blob 安全提示通过");
  console.log("六页窄侧栏、可访问控件与历史清空隔离通过");
  console.log("中英文即时切换、持久化与六页窄侧栏布局通过");
  console.log("中英文页面与媒体预览截图已写入 test-results/edge-*-380.png");
} finally {
  await context?.close();
  await server.close();
  await rm(tempRoot, { recursive: true, force: true });
}
