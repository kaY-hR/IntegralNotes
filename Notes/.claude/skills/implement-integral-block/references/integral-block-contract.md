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

The current decorator accepts only these fields:

- `display_name`
- `description`
- `inputs`
- `outputs`

Do not add params schema or custom metadata to the decorator unless the task explicitly changes the SDK itself.

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
    display_name="Example Report",
    description="Describe the block in one sentence.",
    inputs=["source"],
    outputs=["report"],
)
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    source_root = require_existing_directory(inputs, "source")
    report_root = require_output_directory(outputs, "report")
    options = params or {}
    report_root.mkdir(parents=True, exist_ok=True)
    ...
```

Interpret the arguments this way:

- `inputs[slot]`: absolute directory path for the resolved input dataset, or `None`
- `outputs[slot]`: absolute directory path reserved for the output dataset, or `None`
- `params`: free-form object from the note source, or `None`

The callable should write files into the output directory. It should not return data to the app.

## Note Source Pattern

The user-facing note block should stay simple:

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
- Create the output directory with `mkdir(parents=True, exist_ok=True)` before writing files.
- Emit stable filenames so the dataset is easy to inspect later.
- Prefer UTF-8 text output.
- If the block is meant for human inspection, generate at least one renderable file such as HTML or text.
- If the block has no inputs, remove the unused `inputs` variable intentionally with `del inputs`.

## Common Mistakes

- expecting dataset IDs instead of resolved paths
- reading `analysis-args.json` inside the user script
- writing outside the assigned output directory
- adding blank lines or extra decorators that break callable discovery
- treating the decorator as a place for runtime params schema
- putting new scripts outside `scripts/` when import simplicity matters
