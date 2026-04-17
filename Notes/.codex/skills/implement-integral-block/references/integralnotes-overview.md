# IntegralNotes Overview

Read the product docs when the task needs broader context:

- `../../../../docs/10_要求/00_プロダクト概要.md`
- `../../../../docs/10_要求/10_MVP要件.md`
- `../../../../docs/10_要求/20_ユーザー体験.md`
- `../../../../docs/20_アーキテクチャ/20_ブロックとプラグイン.md`
- `../../../../docs/20_アーキテクチャ/30_Python汎用解析プラグイン.md`

## What Kind Of Software This Is

IntegralNotes is a desktop ELN for researchers. It is not a notebook-first system and it is not an app where Python jobs live as hidden backend tasks.

The product is defined by four ideas:

- `note-first`: the canonical human-facing surface is the Markdown note
- `block-based`: analyses are expressed as `itg-notes` YAML blocks inside the note
- `results-focused`: the important thing is that outputs remain attached to the note and can be reopened later
- `plugin-extensible`: Python analysis is one plugin path, not a separate product

For AI-assisted implementation, this means the explanation should start from the note source that the user sees, not from internal runner details.

## Data Model That The AI Must Respect

- Users manage `original data`, but processing blocks consume and produce `dataset`.
- In the note source, datasets are written as `.idts` paths.
- Inside the app, the `.idts` path is resolved to a dataset ID and then to a readable directory path.
- At runtime, Python receives resolved absolute paths in `inputs` and `outputs`.
- One output slot means one output dataset. Re-running the block creates a new dataset.

Do not design the script as if it receives dataset IDs, raw manifest JSON, or notebook cell state.

## What A Good Analysis Block Optimizes For

- Human-readable note source that matches `run/use`, `in`, `params`, `out`
- Small, explicit slot names
- Deterministic file output under the assigned output directory
- Renderable artifacts such as HTML, text, JSON, CSV, or images when immediate viewing matters
- Workspace-local Python that does not depend on app-managed package installation

## What Not To Optimize For

- Hidden app-specific metadata contracts inside the script
- Jupyter-like interactive state
- Returning in-memory objects instead of writing files
- Ad-hoc command-line parsing that bypasses the `inputs / outputs / params` callable contract
