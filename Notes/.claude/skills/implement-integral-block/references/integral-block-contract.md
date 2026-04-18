# Integral Block Contract

Inspect these example files when you need concrete patterns:

- `../../../demo_hello_report.py`
- `../../../demo_dataset_report.py`
- `../../../scripts/integral/__init__.py`
- `../../../scripts/integral/README.md`

## Decorator Contract

Use the SDK exactly as it exists today:

```python
from integral import integral_block
```

The current decorator accepts these top-level fields:

- `display_name`
- `description`
- `inputs`
- `outputs`

Each slot item may be either:

- string shorthand such as `"source"`
- object form such as `{"name": "report", "extension": ".html", "format": "report/html"}`

On output slots, the SDK also supports:

- `auto_insert_to_work_note`
- `project_to_inputs`

Do not add params schema or decorator metadata beyond what the SDK already supports unless the task explicitly changes the SDK itself.

## Discovery Contract

The current MVP discovery path expects a regex-friendly shape:

```python
@integral_block(...)
def main(...):
    ...
```

Keep these constraints:

- the callable should be top-level
- `@integral_block(...)` should be immediately followed by `def ...(`
- avoid stacking other decorators above or below it unless the task also updates discovery

## Runtime Contract

Use this function shape:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

from integral import integral_block


@integral_block(
    display_name="Example Convert And Plot",
    description="Describe the block in one sentence.",
    inputs=[
        {"name": "source", "extensions": [".idts"], "format": "bundle/idts"},
    ],
    outputs=[
        {
            "name": "json",
            "extension": ".json",
            "format": "chromatogram/json",
            "project_to_inputs": ["source"],
        },
        {
            "name": "plot",
            "extension": ".html",
            "format": "report/html",
            "auto_insert_to_work_note": True,
            "project_to_inputs": ["source"],
        },
    ],
)
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    source_root = require_existing_directory(inputs, "source")
    json_path = require_output_file(outputs, "json")
    plot_path = require_output_file(outputs, "plot")
    options = params or {}
    json_path.parent.mkdir(parents=True, exist_ok=True)
    plot_path.parent.mkdir(parents=True, exist_ok=True)
    ...
```

Interpret the arguments this way:

- non-`.idts` `inputs[slot]`: absolute file path chosen by the user, or `None`
- `.idts` `inputs[slot]`: absolute directory path resolved from the bundle, or `None`
- non-`.idts` `outputs[slot]`: absolute file path reserved for the output file, or `None`
- `.idts` `outputs[slot]`: absolute directory path reserved for the bundle contents, or `None`
- `params`: free-form object from the note source, or `None`

The callable should write files to the assigned output path or bundle directory. It should not return data to the app.

## Note Source Pattern

The user-facing note block should stay simple:

```itg-notes
id: BLK-1F8E2D0A
run: scripts/demo_hello_report.py:main
params:
  title: Image Set Report
out:
  report: /Results/image-set-report.html
```

If a slot needs multiple files, use `.idts` explicitly:

```itg-notes
id: BLK-1F8E2D0A
run: scripts/demo_dataset_report.py:main
in:
  source: /datasets/images.idts
params:
  title: Image Set Report
  max_rows: 100
out:
  report: auto
```

The AI should reason from this source format first, then map it to Python implementation details.

## Implementation Heuristics

- Validate required input paths explicitly with `Path`.
- Convert optional `params` using `options = params or {}`.
- For single-file output, create the parent directory with `output_path.parent.mkdir(...)`.
- For `.idts` output, create the bundle directory with `output_root.mkdir(...)`.
- Prefer emitting both a machine-friendly intermediate file and a human-friendly renderable in the same block when they naturally come from the same source data.
- Emit stable filenames so the output is easy to inspect later.
- Prefer UTF-8 text output.
- If the block is meant for human inspection, generate at least one renderable file such as HTML or text.
- If the block has no inputs, remove the unused `inputs` variable intentionally with `del inputs`.

## Common Mistakes

- expecting dataset IDs instead of resolved paths
- reading `analysis-args.json` inside the user script
- assuming every slot path is a dataset directory
- writing outside the assigned output path or bundle directory
- adding blank lines or extra decorators that break callable discovery
- treating the decorator as a place for runtime params schema
- forgetting that work-note / data-note projection is controlled by output slot metadata, not by ad hoc Markdown writes from Python
- putting new scripts outside `scripts/` when import simplicity matters
