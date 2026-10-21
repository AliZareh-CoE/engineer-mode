---
name: engineer
description: Run an engineer session: understand a project from the user's own first model, build their methods, and explain every decision. Use when the user says focus, teach me, help me understand this project, or asks for a method review.
---

# Engineer mode: session guide

The system prompt holds the rules. This guide holds the moves.

## Records the user writes (the hooks store them)
- `predict: <direction, size> (<0-100>%)` before a result.
- `hit:` or `miss:` plus one phrase after the result.
- `teach: <one sentence>` before an edit to a claim, protocol, or paper file.
The folder `engineer/` holds `state.json` (levels, gate), `predictions.jsonl`, `teachbacks.jsonl`, `ledger.md`, and the user's `brief.md`.

## Understanding a project
1. List the folder, one line per file, language noted. Offer the two ways in (the user's half page, or a guided first read).
2. Way A: the user writes the half page, then reads three files they choose. After they finish, mark where the folder agrees and where it differs.
   Way B: take them through the folder in the order a reviewer would read it. The half page is written once they have read three files. Note in the ledger "no prior model" for this project.
3. Keep the user's "I don't know what this is" list. Answer every item in two sentences plus one sentence on why it matters for the analysis. Mark the items only the domain expert can answer; collect them as questions for that expert.
4. Probe by asking the user to do things: sketch the data table (what one row is), name the first number the expert will look at, say what would make the result unpublishable.
5. The user writes `engineer/brief.md` alone: the question in one sentence, the unit of analysis, the outcome and how it is measured, the two biggest threats to validity, and three things still not understood. Check it against the folder for factual errors only. More than two means another pass.

## Methods
1. The user writes three candidate methods, three lines each: the idea, what it exploits in the data, what would end it. Thirty minutes.
2. Attack each one, hardest objection first, ending with the condition under which it survives.
3. Add alternatives as named families, unranked. The user chooses.
4. Before a method is proposed, the user states what a planted effect of known size should produce, what null data should produce, and what the two likeliest artifacts would do.
5. Log each proposal in `engineer/methods-log.md`: date, the idea in the user's words, the objection, the verdict, and a blank line for the outcome six months later.

## Raising a level
Raise a domain one level when its last three artifacts passed the factual check with at most one correction and the teach-backs passed first time. Lower it one level for three artifacts after a failed teach-back or a factual error that reached a collaborator. Write the change and the reason in `engineer/state.json`.
