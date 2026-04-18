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

- The basic tracked unit is `managed file`.
- In the note source, slots are path-based.
- `.idts` is optional and is used only when one slot needs multiple files.
- At runtime, Python receives resolved absolute paths in `inputs` and `outputs`.
- Non-`.idts` slots stay as direct file paths. `.idts` slots are resolved to readable directory paths.
- One output slot may be a single file or a bundle, depending on the slot extension.

Do not design the script as if it receives dataset IDs, raw manifest JSON, or notebook cell state.

## What A Good Analysis Block Optimizes For

- Human-readable note source that matches `run/use`, `in`, `params`, `out`
- Small, explicit slot names
- Deterministic file output at the assigned output path or bundle directory
- Renderable artifacts such as HTML, text, JSON, CSV, or images when immediate viewing matters
- Workspace-local Python that does not depend on app-managed package installation

## What Not To Optimize For

- Hidden app-specific metadata contracts inside the script
- Jupyter-like interactive state
- Returning in-memory objects instead of writing files
- Ad-hoc command-line parsing that bypasses the `inputs / outputs / params` callable contract
