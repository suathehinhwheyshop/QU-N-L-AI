import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
const started = Date.now();
const results = [];
await mkdir("docs/evidence", { recursive: true });
for (const [name, script] of [
  ["unit", "test"],
  ["integration", "test:integration"],
  ["typecheck", "typecheck"],
  ["build", "build"],
  ["e2e", "test:e2e"],
]) {
  const command = ["run", script];
  let output = "";
  const process = spawn("npm", command, { stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.on("data", (b) => (output += b.toString()));
  process.stderr.on("data", (b) => (output += b.toString()));
  const code = await new Promise((resolve, reject) => {
    process.once("exit", resolve);
    process.once("error", reject);
  });
  const transcript =
    output
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trimEnd() + "\n";
  await writeFile(`docs/evidence/${name}.log`, transcript);
  const count =
    name === "unit" || name === "integration"
      ? Number(output.match(/ℹ tests (\d+)/)?.[1])
      : undefined;
  if (
    code !== 0 ||
    ((name === "unit" || name === "integration") && !(count > 0))
  ) {
    console.error(`${name} FAILED. See docs/evidence/${name}.log`);
    globalThis.process.exit(1);
  }
  results.push({
    name,
    command: "npm " + command.join(" "),
    status: "PASS",
    ...(count ? { tests: count } : {}),
    log: `${name}.log`,
  });
  console.log(`${name}: PASS${count ? " (" + count + " tests)" : ""}`);
}
const e2e = JSON.parse(await readFile("docs/evidence/phase1-e2e.json", "utf8"));
if (e2e.result !== "PASS" || Date.parse(e2e.at) < started)
  throw Error("Missing fresh E2E evidence");
await writeFile(
  "docs/evidence/verification.json",
  JSON.stringify(
    {
      status: "PASS",
      mode: "MOCK",
      at: new Date().toISOString(),
      results,
      e2e_run_id: e2e.run_id,
      notice:
        "Only Foundation verification; no real AI/GSC or website modification.",
    },
    null,
    2,
  ),
);
