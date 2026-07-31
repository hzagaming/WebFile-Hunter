import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const temporaryDirectories: string[] = [];

async function releaseFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "webfile-hunter-release-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "icons"));
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Fixture",
      version: "1.0.0",
      background: { service_worker: "worker.js" }
    })
  );
  await writeFile(join(root, "worker.js"), "const ready = true;\n");
  return root;
}

async function validate(root: string) {
  return execute(process.execPath, [resolve("scripts/validate-manifest.mjs"), root]);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("release scripts", () => {
  it("正式 manifest 可识别任意普通网页但仍按站点申请内容权限", async () => {
    const manifest = JSON.parse(await readFile(resolve("manifest.json"), "utf8")) as {
      permissions?: string[];
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };

    expect(manifest.permissions).toContain("tabs");
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
  });

  it("拒绝发布包中的 TODO/FIXME 标记", async () => {
    const root = await releaseFixture();
    await writeFile(join(root, "asset.js"), "const unfinished = 'FIXME';\n");
    await expect(validate(root)).rejects.toThrow(/TODO|FIXME/);
  });

  it("拒绝私钥和常见访问密钥", async () => {
    const root = await releaseFixture();
    await writeFile(join(root, "secret.txt"), "-----BEGIN PRIVATE KEY-----\nfixture\n");
    await expect(validate(root)).rejects.toThrow(/密钥|私钥/);
  });

  it("拒绝测试文件和多段 env 文件名", async () => {
    const testRoot = await releaseFixture();
    await writeFile(join(testRoot, "bundle.test.js"), "const fixture = true;\n");
    await expect(validate(testRoot)).rejects.toThrow(/禁止文件/);

    const envRoot = await releaseFixture();
    await writeFile(join(envRoot, ".env.production"), "SAFE_FIXTURE=true\n");
    await expect(validate(envRoot)).rejects.toThrow(/禁止文件/);
  });

  it("提供 Windows、Linux 与 macOS 的 Edge 候选路径", async () => {
    const moduleUrl = pathToFileURL(resolve("scripts/edge-paths.mjs")).href;
    const source = `
      import { edgeCandidates } from ${JSON.stringify(moduleUrl)};
      const values = {
        darwin: edgeCandidates("darwin", {}),
        linux: edgeCandidates("linux", {}),
        win32: edgeCandidates("win32", { PROGRAMFILES: "C:\\\\Program Files" })
      };
      console.log(JSON.stringify(values));
    `;
    const { stdout } = await execute(process.execPath, ["--input-type=module", "--eval", source]);
    const paths = JSON.parse(stdout) as {
      darwin: string[];
      linux: string[];
      win32: string[];
    };
    expect(paths.darwin.join("\n")).toContain("Microsoft Edge.app");
    expect(paths.linux).toContain("/usr/bin/microsoft-edge");
    expect(paths.win32.join("\n")).toContain("msedge.exe");
  });
});
