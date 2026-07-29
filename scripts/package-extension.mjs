import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { zipSync } from "fflate";
import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} 退出码 ${code}`))
    );
  });
}

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = {};
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) Object.assign(output, await collect(absolute));
    else
      output[relative(resolve("dist"), absolute).replaceAll("\\", "/")] = new Uint8Array(
        await readFile(absolute)
      );
  }
  return output;
}

await run(process.execPath, [resolve("scripts/validate-manifest.mjs"), resolve("dist")]);
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
await mkdir(resolve("release"), { recursive: true });
const output = resolve(`release/webfile-hunter-v${packageJson.version}.zip`);
await writeFile(output, zipSync(await collect(resolve("dist")), { level: 9 }));
console.log(`发布包已生成：${output}`);
