---
name: implement-integral-block
description: "Use when implementing or revising an IntegralNotes Python analysis block based on `from integral import integral_block`, including `run: relative/path.py:function` note blocks, path-based slot I/O, optional `.idts` bundle handling, and demo scripts under `Notes/`."
---

# Implement Integral Block

Use this skill when the user wants a new IntegralNotes analysis block, wants to revise an existing `@integral_block` script, or asks how Python callable discovery and execution should work.

## First Read

Read these references in order before editing:

1. [references/integralnotes-overview.md](references/integralnotes-overview.md)
2. [references/integral-block-contract.md](references/integral-block-contract.md)

Only after that, inspect the current workspace examples that match the task:

- `../../../demo_hello_report.py`
- `../../../demo_dataset_report.py`
- `../../../src/lc_text_to_chromatogram_json.py`
- `../../../src/chromatogram_pca.py`
- `../../../scripts/integral/__init__.py`
- `../../../scripts/integral/README.md`

## Working Rules

- Start by explaining IntegralNotes as a note-first, block-based, results-focused ELN before jumping into decorator details.
- Anchor explanations in the user-facing note source: `run/use`, `in`, `params`, `out`.
- Treat slot I/O as path-based.
- Non-`.idts` inputs are passed to Python as direct file paths.
- Non-`.idts` outputs are passed to Python as direct file paths.
- `.idts` inputs and outputs are the exception: Python receives a resolved directory path for the bundle contents.
- Keep callable discovery simple: a top-level `@integral_block(...)` immediately followed by `def ...(`.
- Prefer new scripts inside `../../../scripts/` when the block should import `from integral import integral_block` without extra path setup.
- Write stable UTF-8 output files at the assigned output path or inside the assigned bundle directory.
- If the user wants the result to be viewable inside IntegralNotes, emit at least one renderable file such as `index.html`, `README.txt`, `*.json`, `*.csv`, or an image.
- Use output slot metadata when it matches the UX goal:
  - `auto_insert_to_work_note=True` for user-facing renderables that should appear right under the block
  - `share_note_with_input="source"` to make an output reuse the referenced input's data-note target
  - `embed_to_shared_note=True` when the output should also append provenance and `![]()` to that shared data-note
- Do not invent decorator features that do not exist. The current SDK accepts `display_name`, `description`, `inputs`, and `outputs`, and slot items may be string shorthand or object form with `name`, `extension`/`extensions`, `format`, and on output slots `auto_insert_to_work_note` / `share_note_with_input` / `embed_to_shared_note`.
- Do not make the Python script depend on reading `analysis-args.json`. The runner handles that and calls the function with `inputs`, `outputs`, and `params`.

## Delivery Checklist

Before finishing, verify:

- the callable keeps the expected signature
- slot names in code match the decorator
- invalid or missing paths fail clearly
- output files are written to the assigned output path or inside the assigned bundle directory
- output slot metadata matches the intended work-note / data-note behavior
- the user can describe the block in note source as `run: relative/path.py:function`
