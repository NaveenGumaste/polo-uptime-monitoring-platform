import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const standalone = path.join(root, ".next/standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  throw new Error("Run bun run build before starting the standalone server.");
}
await mkdir(path.join(standalone, ".next"), { recursive: true });
await cp(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
if (existsSync(path.join(root, "public"))) {
  await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
}
await import(pathToFileURL(path.join(standalone, "server.js")).href);
