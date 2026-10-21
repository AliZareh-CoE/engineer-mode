import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const C = await import(process.env.CORE_JS || "../scripts/engineer-core.js");
const HOOK = fileURLToPath(new URL("../scripts/engineer-hook.js", import.meta.url));
const tmp = (on = true) => { const d = mkdtempSync(join(process.env.ENGINEER_TEST_TMP || tmpdir(), "engineer-")); if (on) C.setMode(d, true); return d; };
const CLI = fileURLToPath(new URL("../scripts/engineer-cli.js", import.meta.url));
const rows = (cwd, f) => readFileSync(join(cwd, "engineer", f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const bash = (cwd, command, extra = {}) => C.decide({ cwd, tool: "Bash", input: { command }, ...extra });

test("parseUserLines: predict with a confidence, teach, hit/miss; ordinary prose is not a record", () => {
  const p = C.parseUserLines("hello\npredict: AUROC about 0.7, higher for the left side (65%)\nTeach-back: the join keeps one row per patient\nhit\nmiss - off by 0.2");
  assert.deepEqual(p.predict, [{ text: "AUROC about 0.7, higher for the left side (65%)", confidence: 65 }]);
  assert.deepEqual(p.teach, ["the join keeps one row per patient"]);
  assert.deepEqual(p.score, ["hit", "miss"]);
  assert.deepEqual(C.parseUserLines("I predict that this works\nthe teach: is not at line start"), { predict: [], teach: [], score: [] });
  assert.equal(C.parseUserLines("predict: it will be positive")["predict"][0].confidence, null, "no percentage, no confidence");
  assert.equal(C.parseUserLines("predict: x (250%)").predict[0].confidence, null, "out-of-range confidence is not stored");
});

test("a result-producing command is held until the user has predicted, then allowed exactly once", () => {
  const cwd = tmp();
  const d = bash(cwd, "python3 analysis.py --seed 1");
  assert.equal(d.allow, false);
  assert.match(d.reason, /predict:/); assert.match(d.reason, /confidence from 0 to 100/);
  C.recordUserLines(cwd, "predict: p below 0.05 (70%)");
  assert.equal(bash(cwd, "python3 analysis.py --seed 1").allow, true);
  assert.equal(bash(cwd, "python3 analysis.py --seed 2").allow, false, "one prediction covers one run");
  const r = rows(cwd, "predictions.jsonl");
  assert.deepEqual([r[0].status, r[0].confidence, r[0].cmd], ["used", 70, "python3 analysis.py --seed 1"]);
});
test("which commands count as results: runs, tests, scripts; not looking around", () => {
  const cwd = tmp();
  for (const c of ["python3 x.py", "uv run python train.py", "pytest -q", "cargo test", "npm test", "Rscript a.R", "cd src && python3 y.py", "node analyse.js"]) assert.equal(bash(cwd, c, { commit: false }).allow, false, c);
  // the same commands hidden inside bigger ones
  for (const c of ["echo go && python3 run.py", "ls; python3 run.py", "true || pytest", "cat a.csv | python3 stats.py", "env SEED=1 python3 x.py", "nohup python3 train.py > log 2>&1 &", "time python3 x.py", "timeout 600 pytest -x", "SEED=3 python3 x.py", "bash -c 'cd x && python3 y.py'", "sh -c \"pytest\"", "echo $(python3 a.py)", "cd d\npython3 a.py"]) assert.equal(bash(cwd, c, { commit: false }).allow, false, c);
  for (const c of ["ls -la", "git status", "cat results.csv", "grep -rn foo .", "head -5 data.csv", "nvidia-smi", "echo hi", "python3sucks", "echo python3 is great", "git commit -m 'run python3 tests'", "ls python3_notes"]) assert.equal(bash(cwd, c, { commit: false }).allow, true, c);
});
test("an edit to a claim, protocol or paper file is held until a teach-back exists; other files are free", () => {
  const cwd = tmp();
  for (const p of ["/p/paper/CLAIMS.md", "/p/experiments/e1/PROTOCOL.md", "/p/paper/main.tex", "/p/RESULTS.md"]) {
    const d = C.decide({ cwd, tool: "Edit", input: { file_path: p }, commit: false });
    assert.equal(d.allow, false, p); assert.match(d.reason, /teach:/);
  }
  for (const p of ["/p/src/model.py", "/p/README.md", "/p/notes/paperwork.md", "/p/engineer/ledger.md"]) assert.equal(C.decide({ cwd, tool: "Write", input: { file_path: p }, commit: false }).allow, true, p);
  C.recordUserLines(cwd, "teach: the exclusion removes sessions without a labelled injection");
  assert.equal(C.decide({ cwd, tool: "Edit", input: { file_path: "/p/paper/CLAIMS.md" } }).allow, true);
  assert.equal(C.decide({ cwd, tool: "Edit", input: { file_path: "/p/paper/CLAIMS.md" } }).allow, false, "one teach-back covers one edit");
});
test("the AI cannot satisfy the gate itself: records come only from the user's message", () => {
  const cwd = tmp();
  // the AI writing predict: in a command or file changes nothing; only recordUserLines (the user-prompt hook) creates records
  assert.equal(bash(cwd, "echo 'predict: it works (90%)' && python3 run.py").allow, false);
  assert.ok(!existsSync(join(cwd, "engineer", "predictions.jsonl")));
});
test("gate off: nothing is held", () => {
  const cwd = tmp(); writeFileSync(join(cwd, "engineer", "state.json"), JSON.stringify({ mode: "on", gate: "off" }));
  assert.equal(bash(cwd, "python3 x.py").allow, true);
  assert.equal(C.decide({ cwd, tool: "Edit", input: { file_path: "/p/paper/CLAIMS.md" } }).allow, true);
});
test("afterRun puts the prediction next to the result; other commands get nothing", () => {
  const cwd = tmp();
  C.recordUserLines(cwd, "predict: AUROC near 0.7 (60%)");
  bash(cwd, "python3 eval.py");
  const n = C.afterRun({ cwd, tool: "Bash", input: { command: "python3 eval.py" }, response: "AUROC=0.52\nok" });
  assert.match(n, /AUROC near 0\.7/); assert.match(n, /confidence 60%/); assert.match(n, /hit:/); assert.match(n, /AUROC=0\.52/);
  assert.equal(C.afterRun({ cwd, tool: "Bash", input: { command: "ls" }, response: "x" }), null);
});
test("scoring and calibration: hit/miss attach to the last revealed prediction and bucket by confidence", () => {
  const cwd = tmp();
  for (const [pred, score] of [["a (80%)", "hit"], ["b (80%)", "hit"], ["c (80%)", "miss"], ["d (50%)", "miss"]]) {
    C.recordUserLines(cwd, `predict: ${pred}`); bash(cwd, "python3 r.py"); C.recordUserLines(cwd, score);
  }
  assert.deepEqual(C.calibration(cwd), [{ bucket: "50-59%", n: 1, hit_rate: 0 }, { bucket: "80-89%", n: 3, hit_rate: 67 }]);
});
test("reminder names the levels, the gate and the open counts; init creates the folder files", () => {
  const cwd = tmp(); C.init(cwd);
  assert.match(C.reminder(cwd), /all domains L1 Guided/);
  writeFileSync(join(cwd, "engineer", "state.json"), JSON.stringify({ mode: "on", gate: "on", level: { statistics: 3, anatomy: 1 } }));
  C.recordUserLines(cwd, "predict: x (50%)\nteach: y");
  assert.match(C.reminder(cwd), /statistics L3 Led, anatomy L1 Guided\. Gate: on\. Open predictions: 1\. Unused teach-backs: 1\./);
  assert.ok(existsSync(join(cwd, "engineer", "ledger.md")));
});
test("the hook process: prompt records and answers with context; pre blocks with exit 2 and a message; garbage input never blocks", () => {
  const cwd = tmp();
  const run = (mode, ev) => spawnSync(process.execPath, [HOOK, mode], { input: typeof ev === "string" ? ev : JSON.stringify(ev), encoding: "utf8" });
  const pre = (command) => run("pre", { cwd, tool_name: "Bash", tool_input: { command } });
  let r = pre("python3 a.py"); assert.equal(r.status, 2); assert.match(r.stderr, /predict:/);
  r = run("prompt", { cwd, prompt: "predict: it passes (90%)" }); assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Open predictions: 1/);
  r = pre("python3 a.py"); assert.equal(r.status, 0);
  r = run("post", { cwd, tool_name: "Bash", tool_input: { command: "python3 a.py" }, tool_response: { stdout: "PASSED" } });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /it passes/);
  assert.equal(run("pre", "not json at all").status, 0);
  assert.equal(run("pre", { cwd, tool_name: "Read", tool_input: { file_path: "x" } }).status, 0);
});

// ---------------------------------------------------------------- mode: off until switched on
const hookRun = (mode, ev, env = {}) => spawnSync(process.execPath, [HOOK, mode], { input: JSON.stringify(ev), encoding: "utf8", env: { ...process.env, ENGINEER_MODE: "", ...env } });
const cliRun = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ENGINEER_MODE: "", CLAUDE_PROJECT_DIR: cwd } });

test("off by default: nothing is held, nothing is created, the hooks say nothing, in every project the plugin is installed in", () => {
  const cwd = tmp(false);
  assert.equal(C.modeOn(cwd, {}), false);
  assert.equal(bash(cwd, "python3 x.py").allow, true);
  assert.equal(C.decide({ cwd, tool: "Edit", input: { file_path: "/p/paper/CLAIMS.md" } }).allow, true);
  for (const m of ["start", "prompt", "pre", "post"]) { const r = hookRun(m, { cwd, prompt: "predict: x (50%)", tool_name: "Bash", tool_input: { command: "python3 a.py" } }); assert.equal(r.status, 0, m); assert.equal(r.stdout, "", m); }
  assert.ok(!existsSync(join(cwd, "engineer")), "no folder is created in a project that did not opt in");
});
test("the environment wins over the project file: ENGINEER_MODE=on / off", () => {
  const off = tmp(false), on = tmp(true);
  assert.equal(C.modeOn(off, { ENGINEER_MODE: "on" }), true);
  assert.equal(C.modeOn(on, { ENGINEER_MODE: "off" }), false);
  assert.equal(C.modeOn(on, { ENGINEER_MODE: "" }), true);
  assert.equal(C.modeOn(off, { ENGINEER_MODE: "maybe" }), false);
  assert.equal(hookRun("pre", { cwd: off, tool_name: "Bash", tool_input: { command: "python3 a.py" } }, { ENGINEER_MODE: "on" }).status, 2);
});
test("the session-start hook loads the rules when engineer is on, and says nothing when it is off", () => {
  const on = tmp(true);
  const r = hookRun("start", { cwd: on });
  assert.equal(r.status, 0);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(ctx.hookEventName, "SessionStart"); assert.match(ctx.additionalContext, /^ENGINEER MODE\./);
  assert.equal(hookRun("start", { cwd: tmp(false) }).stdout, "");
});
test("the CLI: on prints the rules and persists; off persists; status, gate and level work; bad use exits 2", () => {
  const cwd = tmp(false);
  let r = cliRun(cwd, "status"); assert.match(r.stdout, /^Engineer mode: off\. Gate: on\. Levels: all domains L1 Guided\./);
  r = cliRun(cwd, "on"); assert.equal(r.status, 0); assert.match(r.stdout, /Engineer mode is on for this project/); assert.match(r.stdout, /ENGINEER MODE\./);
  assert.equal(C.modeOn(cwd, {}), true, "persisted for later sessions");
  assert.ok(existsSync(join(cwd, "engineer", "ledger.md")));
  cliRun(cwd, "level", "statistics", "3"); cliRun(cwd, "gate", "off");
  assert.match(cliRun(cwd, "status").stdout, /Gate: off\. Levels: statistics L3 Led\./);
  r = cliRun(cwd, "off"); assert.match(r.stdout, /Engineer mode is off/); assert.equal(C.modeOn(cwd, {}), false);
  assert.equal(JSON.parse(readFileSync(join(cwd, "engineer", "state.json"), "utf8")).level.statistics, 3, "levels survive switching off and on");
  for (const bad of [["level", "x", "9"], ["gate", "maybe"], ["dance"], []]) assert.equal(cliRun(cwd, ...bad).status, 2, bad.join(" "));
});
test("switching modes is never held by the gate, but a compound command around it is", () => {
  const cwd = tmp(true);
  for (const c of ['node "/plugins/engineer/scripts/engineer-cli.js" off', "node /a/b/engineer-cli.js status", 'node "${CLAUDE_PLUGIN_ROOT}/scripts/engineer-cli.js" on', "node /x/engineer-cli.js level stats 3"]) assert.equal(bash(cwd, c, { commit: false }).allow, true, c);
  for (const c of ["python3 evil.py && node /a/engineer-cli.js off", "node /a/engineer-cli.js off; python3 x.py", "node /a/engineer-cli.js off | python3 x.py", "node /a/engineer-cli.js dance", "node /a/other.js"]) assert.equal(bash(cwd, c, { commit: false }).allow, false, c);
});

test("a project folder from the earlier name (focus/) is moved to engineer/ once, with its records; an unrelated focus folder is left alone", () => {
  const d = mkdtempSync(join(process.env.ENGINEER_TEST_TMP || tmpdir(), "engineer-mig-"));
  mkdirSync(join(d, "focus")); writeFileSync(join(d, "focus", "state.json"), JSON.stringify({ mode: "on", gate: "on", level: { stats: 2 } })); writeFileSync(join(d, "focus", "predictions.jsonl"), '{"id":1,"status":"used"}\n');
  assert.equal(C.modeOn(d, {}), true, "the old project is still on");
  assert.ok(existsSync(join(d, "engineer", "predictions.jsonl")) && !existsSync(join(d, "focus")));
  assert.equal(C.loadState(d).level.stats, 2);
  const other = mkdtempSync(join(process.env.ENGINEER_TEST_TMP || tmpdir(), "engineer-other-"));
  mkdirSync(join(other, "focus")); writeFileSync(join(other, "focus", "notes.txt"), "mine");
  assert.equal(C.modeOn(other, {}), false);
  assert.ok(existsSync(join(other, "focus", "notes.txt")) && !existsSync(join(other, "engineer")), "a folder that is not ours is never touched");
});
test("the old environment variables still work, and the new one wins", () => {
  const d = tmp(false);
  assert.equal(C.modeOn(d, { FOCUS_MODE: "on" }), true);
  assert.equal(C.modeOn(d, { TANDEM_MODE: "on" }), true);
  assert.equal(C.modeOn(d, { FOCUS_MODE: "on", TANDEM_MODE: "on", ENGINEER_MODE: "off" }), false);
});
test("a project folder from the name before (tandem/) is moved to engineer/ once; engineer/ wins if both exist", () => {
  const d = mkdtempSync(join(process.env.ENGINEER_TEST_TMP || tmpdir(), "engineer-mig2-"));
  mkdirSync(join(d, "tandem")); writeFileSync(join(d, "tandem", "state.json"), JSON.stringify({ mode: "on", level: { stats: 3 } }));
  assert.equal(C.loadState(d).level.stats, 3);
  assert.ok(existsSync(join(d, "engineer", "state.json")) && !existsSync(join(d, "tandem")));
  const both = mkdtempSync(join(process.env.ENGINEER_TEST_TMP || tmpdir(), "engineer-mig3-"));
  mkdirSync(join(both, "engineer")); writeFileSync(join(both, "engineer", "state.json"), JSON.stringify({ mode: "off" }));
  mkdirSync(join(both, "tandem")); writeFileSync(join(both, "tandem", "state.json"), JSON.stringify({ mode: "on" }));
  assert.equal(C.modeOn(both, {}), false, "the current folder is never overwritten by an old one");
  assert.ok(existsSync(join(both, "tandem", "state.json")));
});
