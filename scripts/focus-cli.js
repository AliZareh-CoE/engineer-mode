#!/usr/bin/env node
// focus-cli.js on | off | status | gate on|off | level <domain> <1-4>
// Run by the /focus:on, /focus:off and /focus:status commands. `on` prints the rules so the session follows them from now on.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEVELS, loadState, modeOn, setMode } from "./focus-core.js";
import { writeFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const [cmd, a, b] = process.argv.slice(2);

function save(patch) {
  const st = loadState(cwd);
  writeFileSync(join(cwd, "focus", "state.json"), JSON.stringify({ ...st, ...patch }, null, 2) + "\n");
}

if (cmd === "on") {
  setMode(cwd, true);
  let rules = "";
  try { rules = readFileSync(join(root, "prompts", "focus-system.md"), "utf8"); } catch { /* the plugin folder is incomplete */ }
  console.log(`Focus mode is on for this project. Follow these rules for the rest of this session and tell the user in one sentence that focus mode is on:\n\n${rules}`);
} else if (cmd === "off") {
  setMode(cwd, false);
  console.log("Focus mode is off for this project. Tell the user in one sentence, and return to normal working from this reply on.");
} else if (cmd === "status") {
  const st = loadState(cwd);
  const lv = Object.entries(st.level).map(([d, n]) => `${d} L${n} ${LEVELS[n] || ""}`).join(", ") || "all domains L1 Guided";
  console.log(`Focus mode: ${modeOn(cwd) ? "on" : "off"}. Gate: ${st.gate}. Levels: ${lv}.`);
} else if (cmd === "gate" && (a === "on" || a === "off")) {
  setMode(cwd, modeOn(cwd));
  save({ gate: a });
  console.log(`Gate is ${a}.`);
} else if (cmd === "level" && a && /^[1-4]$/.test(b || "")) {
  setMode(cwd, modeOn(cwd));
  save({ level: { ...loadState(cwd).level, [a]: Number(b) } });
  console.log(`${a} is now level ${b} (${LEVELS[Number(b)]}).`);
} else {
  console.error("usage: focus-cli.js on | off | status | gate on|off | level <domain> <1-4>");
  process.exit(2);
}
