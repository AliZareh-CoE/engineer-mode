#!/usr/bin/env node
// Claude Code hook entry point: `node engineer-hook.js <prompt|pre|post>`; the event arrives as JSON on stdin.
// start:  when engineer mode is on, load the rules into the new session
// prompt: record the user's predict:/teach:/hit:/miss: lines, and add a one-line reminder to the turn
// pre:    hold a result-producing command until a prediction exists; hold claim/protocol edits until a teach-back exists
// post:   after a gated command, put the prediction next to the result
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterRun, decide, init, modeOn, recordUserLines, reminder } from "./engineer-core.js";

const mode = process.argv[2];
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let ev = {};
  try { ev = JSON.parse(raw); } catch { /* an unreadable event is never a reason to block the user's work */ }
  const cwd = ev.cwd || process.cwd();
  try {
    if (!modeOn(cwd)) process.exit(0); // installed but not switched on for this project: change nothing, create nothing
    if (mode === "start") {
      const rules = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "engineer-system.md"), "utf8");
      init(cwd);
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: rules } }));
    } else if (mode === "prompt") {
      init(cwd);
      recordUserLines(cwd, ev.prompt);
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: reminder(cwd) } }));
    } else if (mode === "pre") {
      const d = decide({ cwd, tool: ev.tool_name, input: ev.tool_input || {} });
      if (!d.allow) { process.stderr.write(d.reason); process.exit(2); }
    } else if (mode === "post") {
      const note = afterRun({ cwd, tool: ev.tool_name, input: ev.tool_input || {}, response: ev.tool_response?.stdout ?? ev.tool_response ?? "" });
      if (note) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note } }));
    }
  } catch (e) {
    process.stderr.write(`engineer hook error (ignored): ${e.message}\n`); // a bug here must never lock the user out
  }
  process.exit(0);
});
