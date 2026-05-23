import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

function insideRoot(path) {
  const relative = path.slice(root.length);
  return path === root || (relative.startsWith("\\") || relative.startsWith("/"));
}

if (!insideRoot(dist) || dist === root) {
  throw new Error(`Refusing to build outside project root: ${dist}`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await cp(resolve(root, "index.html"), resolve(dist, "index.html"));
await cp(resolve(root, "src"), resolve(dist, "src"), { recursive: true });
await cp(resolve(root, "public"), dist, { recursive: true });

console.log(`Built static site to ${dist}`);
