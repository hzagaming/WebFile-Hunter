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
const ungrantedOrigin = "http://ungranted.wfh.test";
testManifest.host_permissions = ["http://127.0.0.1/*", `${recursiveOrigin}/*`];
await writeFile(testManifestPath, JSON.stringify(testManifest));
let context;
const browserErrors = [];

function watchPage(page, label) {
  page.on("pageerror", (error) => browserErrors.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`${label} console: ${message.text()}`);
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

async function assertResultCardControls(page, filename) {
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
      bounds.visibleButtons !== 4
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
          const transaction = database.transaction(["files", "sessions"], "readonly");
          const filesRequest = transaction.objectStore("files").getAll();
          const sessionsRequest = transaction.objectStore("sessions").getAll();
          transaction.oncomplete = () =>
            resolvePromise({ files: filesRequest.result, sessions: sessionsRequest.result });
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
      `--host-resolver-rules=MAP wfh.test:80 127.0.0.1:${server.port},MAP ungranted.wfh.test:80 127.0.0.1:${server.port}`
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

  const ungrantedPage = await context.newPage();
  watchPage(ungrantedPage, "ungranted");
  await ungrantedPage.goto(ungrantedOrigin, { waitUntil: "domcontentloaded" });
  const hasUngrant = await permissionPage.evaluate(
    (origin) => chrome.permissions.contains({ origins: [`${origin}/*`] }),
    ungrantedOrigin
  );
  if (hasUngrant) throw new Error("未授权站点被意外授予了 Host 权限。");
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
          file.warnings.includes("temporary_blob") &&
          file.isDownloadable === false
      )
  );
  const currentFiles = currentRows.files.filter((file) => file.sessionId === currentSession.id);
  if (currentFiles.length < 2) throw new Error("当前页面扫描结果不足。");
  await eventually(
    () => databaseRows(worker),
    (rows) =>
      rows.sessions.find((session) => session.id === currentSession.id)?.status === "completed"
  );

  const liveSession = await send(permissionPage, {
    type: "START_LIVE_MONITOR",
    payload: { tabId, origin: server.origin }
  });
  await fixturePage.locator("#load-audio").click();
  await fixturePage.locator("#load-api").click();
  const liveRows = await eventually(
    () => databaseRows(worker),
    (rows) =>
      rows.files.some(
        (file) =>
          file.sessionId === liveSession.id &&
          file.filename === "report fixture.txt" &&
          file.sources.includes("NETWORK_HEADER")
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
  if (
    completedRecursive?.pagesProcessed !== 3 ||
    !completedRecursive.currentUrl ||
    !completedRecursive.requestsPerMinute ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/files/archive.zip")) ||
    !recursiveFiles.some((file) => file.canonicalUrl.endsWith("/files/sample.txt"))
  ) {
    throw new Error(
      `递归扫描链路不完整：${JSON.stringify({ completedRecursive, files: recursiveFiles.length })}`
    );
  }

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

  const extremeFilename = `${"超长文件名-".repeat(12)}fixture.extremelylongextension`;
  await putDatabaseFile(worker, {
    ...currentFiles[0],
    id: "file-e2e-extreme",
    sessionId: liveSession.id,
    originalUrl: `${server.origin}/files/${encodeURIComponent(extremeFilename)}`,
    canonicalUrl: `${server.origin}/files/${encodeURIComponent(extremeFilename)}`,
    filename: extremeFilename,
    extension: "extremelylongextension",
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
  watchPage(sidepanelPage, "sidepanel");
  await sidepanelPage.setViewportSize({ width: 380, height: 820 });
  await sidepanelPage.goto(`${extensionOrigin}/sidepanel/index.html`, {
    waitUntil: "domcontentloaded"
  });
  await sidepanelPage.getByRole("heading", { name: "WebFile Hunter" }).waitFor();
  await sidepanelPage.getByRole("heading", { name: "开始扫描" }).waitFor();
  const currentSite = sidepanelPage.locator(".app-header p");
  await fixturePage.bringToFront();
  await eventually(
    () => currentSite.getAttribute("title"),
    (title) => title === fixturePage.url()
  );
  for (const name of ["扫描当前页面", "开始实时监听", "同域递归扫描"]) {
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
  await assertResultCardControls(sidepanelPage, extremeFilename);
  await assertLastResultUnobscured(sidepanelPage);

  await sidepanelPage
    .locator(".result-card")
    .filter({
      has: sidepanelPage.getByTitle(downloadableFile.canonicalUrl, { exact: true })
    })
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

  sidepanelPage.once("dialog", (dialog) => void dialog.accept());
  await sidepanelPage.getByRole("button", { name: "加入下载", exact: true }).click();
  const queuedDownloads = await eventually(
    () => send(permissionPage, { type: "GET_DOWNLOADS" }),
    (downloads) =>
      downloads.some((task) => task.candidateId === downloadableFile.id && task.status === "queued")
  );
  const queuedTask = queuedDownloads.find((task) => task.candidateId === downloadableFile.id);
  if (!queuedTask) throw new Error("已选文件未加入下载队列。");

  await sidepanelPage.getByRole("button", { name: "下载", exact: true }).click();
  await sidepanelPage.getByRole("heading", { name: "下载队列" }).waitFor();
  await assertResponsive(sidepanelPage, "下载页");
  await assertActiveNavigation(sidepanelPage, "下载");
  const fileRequestIndex = await prepareDownloadCapture(worker);
  await sidepanelPage.getByRole("button", { name: "开始队列", exact: true }).click();
  const requestedFileDownload = await capturedDownloadRequest(worker, fileRequestIndex);
  const completedDownloads = await eventually(
    () => send(permissionPage, { type: "GET_DOWNLOADS" }),
    (downloads) =>
      downloads.some((task) => task.id === queuedTask.id && task.status === "completed")
  );
  const completedTask = completedDownloads.find((task) => task.id === queuedTask.id);
  if (completedTask?.browserDownloadId === undefined) {
    throw new Error("下载任务完成后缺少 Edge 下载 ID。");
  }
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
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-settings-380.png"),
    fullPage: true
  });

  const settingsBeforeClear = await send(permissionPage, { type: "GET_SETTINGS" });
  await sidepanelPage.getByRole("button", { name: "历史", exact: true }).click();
  sidepanelPage.once("dialog", (dialog) => void dialog.accept());
  await sidepanelPage.getByRole("button", { name: "清空历史", exact: true }).click();
  await sidepanelPage.getByText("暂无扫描历史。", { exact: true }).waitFor();
  await eventually(
    () => databaseRows(worker),
    (rows) => rows.sessions.length === 0 && rows.files.length === 0
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
  console.log("侧栏独立打开时可识别未授权普通网页，内容访问仍保持按站点授权");
  console.log(`当前页扫描通过：${currentFiles.length} 个候选`);
  console.log("blob 临时媒体安全标记通过");
  console.log(`实时监听通过：${apiFile.filename} (${apiFile.mimeType})`);
  console.log("同源导航监听重注入通过");
  console.log(
    `同源 BFS 递归扫描通过：${completedRecursive.pagesProcessed} 页，${recursiveFiles.length} 个候选`
  );
  console.log(
    `递归实时进度通过：${runningProgress.currentUrl}，${runningProgress.requestsPerMinute} 次/分钟`
  );
  console.log("活动标签页切换与导航上下文同步通过");
  console.log("TXT/CSV/JSON 结果导出与历史导出真实落盘通过");
  console.log(`下载队列真实落盘通过：${requestedFileDownload.filename}`);
  console.log("可能资源独立入口与 blob 安全提示通过");
  console.log("五页窄侧栏、可访问控件与历史清空隔离通过");
  console.log("五页截图已写入 test-results/edge-*-380.png");
} finally {
  await context?.close();
  await server.close();
  await rm(tempRoot, { recursive: true, force: true });
}
