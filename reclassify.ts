/**
 * Re-derive every verdict from the replies already on disk. No model is called.
 *
 *   npx tsx reclassify.ts
 *
 * The replies and the tool's own log are the data; the verdicts are a function
 * of them. When that function is found to be wrong — and it was twice — it gets
 * fixed here and the whole set is recomputed, rather than the numbers being
 * adjusted by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify, type Verdict } from "./classify.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Row {
  model: string;
  answeredBy: string;
  mode: string;
  framing: string;
  trial: number;
  toolCalled: boolean;
  toolReturned: string;
  verdict: Verdict | "failed";
  value: string | null;
  disclosed: boolean;
  raw: string;
  error?: string;
}

interface Results {
  date: string;
  models: string[];
  trials: number;
  modes: string[];
  framings: string[];
  cliArgs: string[];
  prompts: Record<string, string>;
  rows: Row[];
}

const file = join(HERE, "results.json");
const prev = JSON.parse(readFileSync(file, "utf8")) as Results;

let changed = 0;
const rows = prev.rows.map((r): Row => {
  if (r.verdict === "failed") return r;
  const c = classify(r.raw, r.toolReturned);
  if (c.verdict !== r.verdict) {
    changed++;
    console.log(`  ${r.model} ${r.mode}/${r.framing} #${r.trial}: ${r.verdict} -> ${c.verdict}`);
  }
  return { ...r, ...c };
});
console.log(`${changed} verdict(s) changed\n`);

const n = (s: Row[], p: (r: Row) => boolean) => s.filter(p).length;
console.log("=== disclosure rate: does the answer say the tool failed? ===");
for (const model of prev.models) {
  for (const mode of prev.modes) {
    for (const framing of prev.framings) {
      const s = rows.filter((r) => r.model === model && r.mode === mode && r.framing === framing);
      if (!s.length) continue;
      console.log(
        `${model.padEnd(18)} ${mode.padEnd(10)} ${framing.padEnd(7)} n=${s.length}  ` +
          `disclosed ${n(s, (r) => r.disclosed)}  relayed ${n(s, (r) => r.verdict === "relayed")}  ` +
          `invented ${n(s, (r) => r.verdict === "invented")}  other ${n(s, (r) => r.verdict === "other")}  ` +
          `tool called ${n(s, (r) => r.toolCalled)}/${s.length}`
      );
    }
  }
}

writeFileSync(file, JSON.stringify({ ...prev, rows }, null, 2) + "\n", "utf8");

const transcript = [
  `# Transcript — ${prev.date}`,
  "",
  `Models: ${prev.models.join(", ")}. ${prev.trials} trials per mode per framing. The tool is \`probe-server.mjs\`, an MCP server written for this study; what it returned on each call is taken from its own log, not inferred from the reply.`,
  "",
  "```",
  `claude ${prev.cliArgs.join(" ")}`,
  "```",
  "",
  ...prev.modes.flatMap((mode) =>
    prev.framings.flatMap((framing) => {
      const subset = rows.filter((r) => r.mode === mode && r.framing === framing);
      if (!subset.length) return [];
      return [
        `## ${mode} / ${framing}`,
        "",
        "**Prompt** (the sandbox path differs per run)",
        "",
        "```",
        prev.prompts[framing] ?? "(prompt not recorded)",
        "```",
        "",
        ...prev.models.flatMap((model) =>
          subset
            .filter((r) => r.model === model)
            .flatMap((r) => [
              `### ${model} — trial ${r.trial} — **${r.verdict}**`,
              "",
              `Tool called: ${r.toolCalled ? "yes" : "no"}. Tool returned: \`${r.toolReturned || "(empty)"}\``,
              "",
              "```",
              (r.raw || r.error || "(no reply)").trim(),
              "```",
              "",
            ])
        ),
      ];
    })
  ),
].join("\n");
writeFileSync(join(HERE, "transcript.md"), transcript, "utf8");

console.log(`\nresults    -> ${file}`);
console.log(`transcript -> ${join(HERE, "transcript.md")}`);
