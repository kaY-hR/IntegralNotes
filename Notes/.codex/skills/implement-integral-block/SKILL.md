---
name: implement-integral-block
description: "Use when implementing or revising a Python analysis block built on `from integral import integral_block`, or when explaining the shipped `integral` SDK contract for `main(inputs, outputs, params)`, slot definitions, path-based file I/O, and optional `.idts` bundle directory handling."
---

# Implement Integral Block

Use this skill when the user wants a new `@integral_block` script, wants to revise an existing block, or asks how the shipped `integral` SDK expects a block file to be authored.

## First Read

Read these references in order before editing:

1. [references/integral-sdk-interface.md](references/integral-sdk-interface.md)
2. [references/block-implementation-patterns.md](references/block-implementation-patterns.md)

Then inspect the shipped SDK and only the local examples that match the task:

- `../../../scripts/integral/__init__.py`
- `../../../scripts/integral/README.md`
- `../../../demo_hello_report.py`
- `../../../demo_dataset_report.py`
- `../../../src/lc_text_to_chromatogram_json.py`
- `../../../src/chromatogram_pca.py`

Do not rely on repository-level product docs, architecture docs, or development history unless the user explicitly asks to change the app/runtime itself. Keep the skill grounded in the distributable SDK and bundled examples.

## Working Rules

- Start from the SDK surface area, not from product positioning.
- Explain blocks in terms of the Python file the user is writing: decorator fields, slot names, path validation, and emitted files.
- Treat slot I/O as path-based.
- Non-`.idts` inputs are file paths.
- Non-`.idts` outputs are file paths.
- `.idts` inputs and outputs are directory paths for bundle contents.
- Keep the callable top-level and keep `@integral_block(...)` immediately above `def ...(`.
- Keep the callable signature `main(inputs, outputs, params)` unless the task explicitly changes the runtime contract.
- Derive decorator capabilities from `../../../scripts/integral/__init__.py`. Do not invent unsupported fields.
- For single-file outputs, create `output_path.parent`.
- For `.idts` outputs, create the assigned directory itself.
- Validate required input paths clearly before doing the real work.
- Use `options = params or {}` for optional params.
- Write stable UTF-8 output files at the assigned output path or inside the assigned bundle directory.
- Use slot `datatype` as the semantic I/O compatibility label between analysis blocks. Prefer namespaced values such as `{user-id}/peak-table` when the app prompt provides a user ID.
- Do not group files with different roles or user intent into one `.idts` output just for convenience.
- Use a `.idts` output only when multiple files of the same nature are generated as one set, such as per-input files or repeated artifacts with the same datatype and role.
- If the user is meant to inspect an output directly, make it its own output slot. This includes HTML reports, plots, images, SVG/PNG/JPEG/WebP files, readable Markdown/text reports, and other renderable artifacts.
- Keep machine-readable or intermediate outputs such as CSV/TSV/JSON separate from user-facing reports unless the user specifically wants that file to be the visible result.
- If the user wants the result to be viewable in the app, emit at least one renderable file such as `index.html`, `README.txt`, `*.json`, `*.csv`, or an image.
- Use output slot metadata when it matches the UX goal:
  - `auto_insert_to_work_note=True` for user-facing renderables that should appear right under the block
  - `auto_insert_to_work_note=False` or omission for CSV/TSV/JSON and other machine-readable or intermediate outputs that should not be inserted into the note
  - `share_note_with_input="source"` to make an output reuse the referenced input's data-note target
  - `embed_to_shared_note=True` when the output should also append provenance and `![]()` to that shared data-note
- If the block lives in a nested folder and should also run directly outside the app, reuse the local `sys.path` bootstrap pattern from `../../../src/*.py` to reach `scripts/integral/`.
- Do not make the Python script depend on reading `analysis-args.json`, hidden store paths, or app-private metadata. The runner handles argument loading and calls the function with `inputs`, `outputs`, and `params`.

## Delivery Checklist

Before finishing, verify:

- the decorator uses only fields supported by the shipped `integral` module
- the callable keeps the expected signature
- slot names in code match the decorator
- invalid or missing paths fail clearly
- output files are written only to the assigned output path or inside the assigned bundle directory
- output slot metadata matches the intended work-note / data-note behavior
- the user can describe the block as a simple `run: relative/path.py:function` entry with `in`, `params`, and `out`
