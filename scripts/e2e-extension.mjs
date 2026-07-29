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
await mkdir(profile, { recursive: true });
await cp(resolve("dist"), extensionDirectory, { recursive: true });
const testManifestPath = join(extensionDirectory, "manifest.json");
const testManifest = JSON.parse(await readFile(testManifestPath, "utf8"));
testManifest.host_permissions = ["http://127.0.0.1/*"];
await writeFile(testManifestPath, JSON.stringify(testManifest));
const server = await startTestServer();
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

try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: edgePath,
    headless: true,
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      "--no-first-run",
      "--no-default-browser-check"
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
      )
  );
  const currentFiles = currentRows.files.filter((file) => file.sessionId === currentSession.id);
  if (currentFiles.length < 2) throw new Error("当前页面扫描结果不足。");

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

  const sidepanelPage = await context.newPage();
  watchPage(sidepanelPage, "sidepanel");
  await sidepanelPage.setViewportSize({ width: 380, height: 820 });
  await sidepanelPage.goto(`${extensionOrigin}/sidepanel/index.html`, {
    waitUntil: "domcontentloaded"
  });
  await sidepanelPage.getByRole("heading", { name: "WebFile Hunter" }).waitFor();
  await sidepanelPage.getByRole("heading", { name: "开始扫描" }).waitFor();
  await assertNoHorizontalOverflow(sidepanelPage, "扫描页");

  await mkdir(resolve("test-results"), { recursive: true });
  await sidepanelPage.getByRole("button", { name: "结果", exact: true }).click();
  await sidepanelPage.getByRole("heading", { name: /发现结果/ }).waitFor();
  await assertNoHorizontalOverflow(sidepanelPage, "结果页");
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-results-380.png"),
    fullPage: true
  });

  await sidepanelPage.getByRole("button", { name: "下载", exact: true }).click();
  await sidepanelPage.getByRole("heading", { name: "下载队列" }).waitFor();
  await assertNoHorizontalOverflow(sidepanelPage, "下载页");

  await sidepanelPage.getByRole("button", { name: "历史", exact: true }).click();
  await sidepanelPage.getByRole("heading", { name: "扫描历史" }).waitFor();
  await assertNoHorizontalOverflow(sidepanelPage, "历史页");
  await sidepanelPage.getByRole("button", { name: "清空历史" }).waitFor();
  if (!(await sidepanelPage.getByRole("button", { name: "导出" }).count())) {
    throw new Error("历史任务缺少单次导出操作。");
  }
  await sidepanelPage.screenshot({
    path: resolve("test-results/edge-history-380.png"),
    fullPage: true
  });

  await sidepanelPage.getByRole("button", { name: "设置", exact: true }).click();
  await sidepanelPage.getByRole("heading", { name: "设置", exact: true }).waitFor();
  await assertNoHorizontalOverflow(sidepanelPage, "设置页");

  if (browserErrors.length) throw new Error(`浏览器页面错误：\n${browserErrors.join("\n")}`);

  console.log(`Edge MV3 加载通过：${extensionOrigin}`);
  console.log(`当前页扫描通过：${currentFiles.length} 个候选`);
  console.log(`实时监听通过：${apiFile.filename} (${apiFile.mimeType})`);
  console.log("同源导航监听重注入通过");
  console.log("五页窄侧栏布局、历史导出与清空操作通过");
  console.log("截图：test-results/edge-results-380.png, test-results/edge-history-380.png");
} finally {
  await context?.close();
  await server.close();
  await rm(tempRoot, { recursive: true, force: true });
}
