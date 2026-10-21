// Focus mode: the part that is enforced by code, not by the model.
//
// State lives in <project>/focus/ (plain files the user can read and edit):
//   state.json         {"level": {"<domain>": 1..4}, "gate": "on"|"off"}
//   predictions.jsonl  what the USER predicted before a result was shown, and whether it was right
//   teachbacks.jsonl   one-line explanations the USER wrote before a claim or protocol was changed
//   ledger.md          the AI's decisions, each with the alternative it set aside (appended by the AI)
//
// Predictions and teach-backs are recorded from the user's own message by the UserPromptSubmit hook, so the AI cannot
// write them for the user. The PreToolUse hook holds a result-producing command (or an edit to a claim/protocol file)
// until the matching record exists, and consumes it when the command is allowed.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_STATE = { gate: "on", level: {} };
export const LEVELS = { 1: "Guided", 2: "Paired", 3: "Led", 4: "Reviewed" };

// Commands that produce a result the user should predict first.
const RUNNER = /^(?:(?:uv|poetry|conda)\s+run\s+)?(?:python3?|pytest|Rscript|jupyter|cargo\s+(?:test|run|bench)|npm\s+(?:test|run)|node|make|bash\s+\S*run\S*|\.\/\S*run\S*)\b/;
const WRAPPERS = /^(?:(?:env|nohup|time|setsid|exec|command)\s+|timeout\s+\S+\s+|nice(?:\s+-n\s*\d+)?\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;

/** Does this shell command produce a result? Every part of a compound command is looked at (&&, ||, ;, |, newlines, sh -c "...", $(...)). */
export function isResultCommand(command, depth = 0) {
  const cmd = String(command || "");
  if (depth > 3) return false;
  for (let seg of cmd.split(/&&|\|\||;|\||\n|\$\(|`|\(|\)/)) {
    seg = seg.trim().replace(WRAPPERS, "");
    if (RUNNER.test(seg)) return true;
    const sh = /^(?:ba|z|da)?sh\s+-c\s+(['"])([\s\S]*)\1\s*$/.exec(seg);
    if (sh && isResultCommand(sh[2], depth + 1)) return true;
  }
  return false;
}
export const RUN_RE = { test: (c) => isResultCommand(c) };
// Files where a claim, a protocol or a paper number lives.
export const GATED_PATH_RE = /(?:^|\/)(?:CLAIMS|PROTOCOL|RESULTS)\.md$|(?:^|\/)paper\//i;

const dir = (cwd) => join(cwd, "focus");
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return d; } };
const readLines = (p) => { try { return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const writeLines = (p, rows) => writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
const ensure = (cwd) => mkdirSync(dir(cwd), { recursive: true });

export const loadState = (cwd) => ({ ...DEFAULT_STATE, ...readJson(join(dir(cwd), "state.json"), {}) });
export const gateOn = (cwd) => loadState(cwd).gate !== "off";

/**
 * Parse the user's own message. Lines that start with a marker are records:
 *   predict: <text> (<0-100>%)      before a result is shown
 *   teach: <one-sentence explanation>   before a claim or protocol edit
 *   hit: / miss:  [optional note]   how the last revealed prediction turned out
 * -> {predict:[{text,confidence}], teach:[text], score:["hit"|"miss"]}
 */
export function parseUserLines(prompt) {
  const out = { predict: [], teach: [], score: [] };
  for (const raw of String(prompt || "").split("\n")) {
    const line = raw.trim();
    let m;
    if ((m = /^predict(?:ion)?\s*:\s*(.+)$/i.exec(line))) {
      const conf = /\b(\d{1,3})\s*%/.exec(m[1]);
      const c = conf ? Number(conf[1]) : null;
      out.predict.push({ text: m[1].trim().slice(0, 400), confidence: c !== null && c >= 0 && c <= 100 ? c : null });
    } else if ((m = /^teach(?:-?back)?\s*:\s*(.+)$/i.exec(line))) out.teach.push(m[1].trim().slice(0, 600));
    else if ((m = /^(hit|miss)\b/i.exec(line))) out.score.push(m[1].toLowerCase());
  }
  return out;
}

/** Record what the user wrote. Returns a short status the hook can show. */
export function recordUserLines(cwd, prompt, now = Date.now()) {
  const p = parseUserLines(prompt);
  if (!p.predict.length && !p.teach.length && !p.score.length) return { recorded: 0 };
  ensure(cwd);
  const pf = join(dir(cwd), "predictions.jsonl"), tf = join(dir(cwd), "teachbacks.jsonl");
  const preds = readLines(pf);
  for (const x of p.predict) preds.push({ id: preds.length + 1, ts: now, text: x.text, confidence: x.confidence, status: "open" });
  for (const s of p.score) {
    const last = [...preds].reverse().find((r) => r.status === "used" && !r.score);
    if (last) last.score = s;
  }
  if (p.predict.length || p.score.length) writeLines(pf, preds);
  const tbs = readLines(tf);
  for (const t of p.teach) tbs.push({ id: tbs.length + 1, ts: now, text: t, status: "open" });
  if (p.teach.length) writeLines(tf, tbs);
  return { recorded: p.predict.length + p.teach.length + p.score.length, ...p };
}

const consumeOldest = (file, now, extra = {}) => {
  const rows = readLines(file);
  const r = rows.find((x) => x.status === "open");
  if (!r) return null;
  r.status = "used"; r.used_ts = now; Object.assign(r, extra);
  writeLines(file, rows);
  return r;
};
const peekOpen = (file) => readLines(file).find((x) => x.status === "open") || null;

/** The tool names that can change files. */
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * Should this tool call be held? -> {allow:true} | {allow:false, reason} where `reason` is addressed to the AI
 * and says what to ask the user for. `commit` consumes the record that lets it through (use false to only look).
 */
export function decide({ cwd, tool, input = {}, now = Date.now(), commit = true }) {
  if (!gateOn(cwd)) return { allow: true };
  const pf = join(dir(cwd), "predictions.jsonl"), tf = join(dir(cwd), "teachbacks.jsonl");
  if (tool === "Bash" && RUN_RE.test(String(input.command || ""))) {
    if (!(commit ? consumeOldest(pf, now, { cmd: String(input.command).slice(0, 200) }) : peekOpen(pf))) {
      return { allow: false, reason: "This command produces a result. Ask the user for their prediction first: the direction, the rough size, and a confidence from 0 to 100. They send it as a line that starts with `predict:`. Run the command after that line arrives." };
    }
    return { allow: true };
  }
  if (WRITE_TOOLS.has(tool)) {
    const path = String(input.file_path || input.notebook_path || "");
    if (GATED_PATH_RE.test(path)) {
      if (!(commit ? consumeOldest(tf, now, { path }) : peekOpen(tf))) {
        return { allow: false, reason: `${path.split("/").slice(-2).join("/")} holds a claim, a protocol or a paper number. Ask the user to explain the change in one sentence, as to a reviewer, on a line that starts with \`teach:\`. Make the edit after that line arrives, and keep the sentence in the ledger.` };
      }
    }
  }
  return { allow: true };
}

/** What the AI gets after a gated command ran: the prediction next to the result, so the comparison is made in the open. */
export function afterRun({ cwd, tool, input = {}, response = "" }) {
  if (!gateOn(cwd) || tool !== "Bash" || !RUN_RE.test(String(input.command || ""))) return null;
  const used = [...readLines(join(dir(cwd), "predictions.jsonl"))].reverse().find((r) => r.status === "used" && String(input.command).startsWith(String(r.cmd || "").slice(0, 60)));
  if (!used) return null;
  const tail = String(typeof response === "string" ? response : JSON.stringify(response)).trim().slice(-300);
  return `The user predicted before this ran: "${used.text}"${used.confidence !== null && used.confidence !== undefined ? ` (confidence ${used.confidence}%)` : ""}. Set the prediction beside the result in your reply, say plainly how they compare, and ask the user to answer with a line that starts with \`hit:\` or \`miss:\` and one phrase on why. Result tail: ${tail}`;
}

/** A compact reminder for the top of every turn. */
export function reminder(cwd) {
  const st = loadState(cwd);
  const lv = Object.entries(st.level).map(([d, n]) => `${d} L${n} ${LEVELS[n] || ""}`).join(", ") || "all domains L1 Guided";
  const open = readLines(join(dir(cwd), "teachbacks.jsonl")).filter((x) => x.status === "open").length;
  const preds = readLines(join(dir(cwd), "predictions.jsonl"));
  const openP = preds.filter((x) => x.status === "open").length;
  return `[focus mode] levels: ${lv}. Gate: ${st.gate}. Open predictions: ${openP}. Unused teach-backs: ${open}. Follow focus/state.json for the level in each domain.`;
}

/** Calibration from the user's own scored predictions: for each confidence bucket, how often they were right. */
export function calibration(cwd) {
  const rows = readLines(join(dir(cwd), "predictions.jsonl")).filter((r) => r.score && r.confidence !== null && r.confidence !== undefined);
  const buckets = new Map();
  for (const r of rows) {
    const b = Math.min(90, Math.floor(r.confidence / 10) * 10);
    const e = buckets.get(b) || { n: 0, hits: 0 };
    e.n++; if (r.score === "hit") e.hits++;
    buckets.set(b, e);
  }
  return [...buckets].sort((a, b) => a[0] - b[0]).map(([b, e]) => ({ bucket: `${b}-${b + 9}%`, n: e.n, hit_rate: Math.round((100 * e.hits) / e.n) }));
}

/** First-run files, so the folder explains itself. */
export function init(cwd) {
  ensure(cwd);
  const sp = join(dir(cwd), "state.json");
  if (!existsSync(sp)) writeFileSync(sp, JSON.stringify(DEFAULT_STATE, null, 2) + "\n");
  const lp = join(dir(cwd), "ledger.md");
  if (!existsSync(lp)) writeFileSync(lp, "# Ledger\n\nEvery decision the AI made, with the alternative it set aside.\n\n");
  return dir(cwd);
}
export const appendLedger = (cwd, line) => { init(cwd); appendFileSync(join(dir(cwd), "ledger.md"), `- ${line}\n`); };
