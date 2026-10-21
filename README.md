# Tandem

A working mode for [Claude Code](https://claude.com/claude-code) in which the AI teaches and you guide, as peers.
It exists for one reason: to stop accepting output you do not understand ("vibe coding", "vibe research") and to keep you the person who decides.

Three parts work together:

- **A system prompt and a skill** set the behaviour: the AI explains, asks one pointed question, answers each proposal with its strongest objection first, and states anything that could sink a result plainly and at once.
- **Hooks** enforce the habits in code, outside the model, so they hold on a long session:
  - A command that produces a result is held until **you** have sent a prediction.
  - An edit to a claim, protocol or paper file is held until **you** have explained the change in one sentence.
- **Plain files** in `tandem/` record what you predicted, how it turned out, and what you explained, so you can read your own track record.

## Install

```
/plugin marketplace add AliZareh-CoE/tandem
/plugin install tandem@tandem
```

To try it without installing: `claude --plugin-dir /path/to/tandem`.

The hooks run with `node` (v18 or later), so `node` must be on the machine.

## Switch it on

Installing changes nothing by itself: tandem mode is **off** until you switch it on for a project.

| Command | Effect |
|---|---|
| `/tandem:on` | on for this project, right now, in the current session (and in every later session there) |
| `/tandem:off` | off for this project |
| `/tandem:status` | shows the mode, the gate and your levels |

Claude Code has its own built-in `/focus` command (a view toggle). Tandem's commands carry the `tandem:` prefix, so they never collide with it.

The mode lives in `tandem/state.json` (`"mode": "on"`). A launcher can force it for one session with the environment variable `TANDEM_MODE=on` (or `off`), which wins over the file.

## Use

Write these at the start of a line in your own messages. The hook stores them, so the AI cannot write them for you.

| You write | When | What happens |
|---|---|---|
| `predict: <direction, size> (70%)` | before a result | releases the next result-producing command, once |
| `hit:` or `miss:` + a phrase | after the result | scores that prediction |
| `teach: <one sentence>` | before editing a claim, protocol or paper file | releases the next such edit, once |

The AI sets your prediction beside the result and says how they compare.

**Starting a project.** Two equal ways in: write what you think the project is, or say you do not know and let the AI walk you through the folder in the order a reviewer would read it. Either way you end by writing a one-page brief alone. See `skills/tandem/SKILL.md` for the full session guide (understanding, methods, levels).

## Levels

Each domain (statistics, anatomy, a codebase) has its own level in `tandem/state.json`:

1. **Guided**: the AI proposes the structure and you fill it.
2. **Paired**: you write the first draft and the AI responds.
3. **Led**: you write the draft and the objection to it; the AI adds what you missed.
4. **Reviewed**: you deliver finished work and the AI reviews it.

The level changes who moves first. It never changes what the AI will say when it sees a real problem.

## Files

```
tandem/
  state.json          levels per domain, gate "on" or "off"
  predictions.jsonl   your predictions, outcomes and scores
  teachbacks.jsonl    your one-sentence explanations
  ledger.md           the AI's decisions, each with the alternative it set aside
```

Set `"gate": "off"` in `state.json` to keep the teaching and drop the holds for that project.

## What it holds, exactly

- **Results:** `python`, `pytest`, `Rscript`, `cargo test|run|bench`, `npm test|run`, `node`, `make`, `jupyter` and run-scripts, including inside `&&`, `;`, pipes, `sh -c "..."`, `env`/`nohup`/`time` wrappers.
- **Files:** `CLAIMS.md`, `PROTOCOL.md`, `RESULTS.md` and anything under `paper/`.

These patterns are a heuristic. A command that produces a result by another route is not held. Adjust `RUN_RE` and `GATED_PATH_RE` in `scripts/tandem-core.js` for your work.

## Calibration

`calibration(cwd)` in `scripts/tandem-core.js` returns, for each confidence bucket, how often your scored predictions were right. If your 80% predictions are right about 80% of the time, you understand the work.

## Test

```
npm test
```

## Design note

Every sentence in the prompts says what to do, with its trigger. Instructions that describe or permit the behaviour you want to avoid tend to pull a model toward it, so the prompts contain none. If you edit them, keep to that.

## License

MIT. Copyright (c) 2026 Ali Zareh.
