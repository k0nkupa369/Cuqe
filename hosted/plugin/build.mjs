import { mkdir, readFile, writeFile } from "node:fs/promises";

const worker = new URL("./worker/index.js", import.meta.url);
const replacement = "const macAgentSource = null;";
const source = await readFile(worker, "utf8");
if (!source.includes(replacement)) throw new Error("The Worker is missing its Mac agent placeholder.");
const agent = await readFile(process.argv[2] ?? new URL("../../scripts/cuqe_hosted.py", import.meta.url), "utf8");
const dist = new URL("./dist/server/", import.meta.url);
await mkdir(dist, { recursive: true });
await writeFile(new URL("index.js", dist), source.replace(replacement, () => "const macAgentSource = " + JSON.stringify(agent) + ";"));
