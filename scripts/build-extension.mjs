import { build } from "vite";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
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

await run(process.execPath, [resolve("scripts/generate-icons.mjs")]);
await build({ configFile: resolve("vite.config.ts") });
await build({ configFile: resolve("vite.content.config.ts") });
await mkdir(resolve("dist"), { recursive: true });
await copyFile(resolve("manifest.json"), resolve("dist/manifest.json"));
await run(process.execPath, [resolve("scripts/validate-manifest.mjs"), resolve("dist")]);
