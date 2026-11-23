import { copyFile, mkdir } from "node:fs/promises";

const output = new URL("./dist/server/", import.meta.url);
await mkdir(output, { recursive: true });
await copyFile(new URL("./worker/index.js", import.meta.url), new URL("index.js", output));
