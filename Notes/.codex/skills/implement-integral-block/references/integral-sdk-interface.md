# Integral SDK Interface

Source of truth:

- `../../../.integral-sdk/python/integral/__init__.py`
- `../../../.integral-sdk/python/integral/README.md`

Use this reference when you need to know what the shipped `integral` module actually supports.

## Import

Use:

```python
from integral import integral_block
```

The module also exports `get_integral_block_spec`, `IntegralBlockSpec`, `IntegralSlotSpec`, and dataset helpers. A normal single-file block usually only needs `integral_block`; a `.idts` dataset block should import the helper it needs.

## Decorator Surface

The current decorator accepts only these keyword arguments:

- `display_name`
- `description`
- `inputs`
- `outputs`
- `params`

Do not invent additional decorator fields unless the task explicitly changes `.integral-sdk/python/integral/__init__.py`.

## Slot Forms

Each item inside `inputs` or `outputs` may be either:

- a string shorthand such as `"source"`
- a Python dict literal object with supported keys, such as `{"name": "source", "extensions": [".csv"]}`

IntegralNotes discovery is static. Even though the runtime SDK accepts any mapping object, author block files with literal `{...}` slot objects. Do not use `dict(name="source", ...)`, variables, helper functions, or class instances for slot definitions if the block should appear with populated `in` / `out` YAML.

Supported object keys:

- `name`
- `extension`
- `extensions`
- `datatype`
- `auto_insert_to_work_note`
- `share_note_with_input`
- `embed_to_shared_note`

Notes:

- `extension` is normalized to lowercase and gets a leading `.` if missing.
- `extension` is merged into `extensions`.
- `extensions` may be one string or a sequence of strings.
- For single-file output slots, prefer the canonical `extension` key. Use `extensions` mainly for input candidate filtering or inputs that accept multiple suffixes.
- `datatype` is a semantic I/O compatibility label. Prefer namespaced values such as `{user-id}/peak-table` when a user ID is available.
- duplicate slot names are rejected case-insensitively.
- boolean fields must be real booleans, not `"true"` or `"false"` strings.
- `project_to_inputs` is removed and raises an error.

## Params Schema

The `params` decorator argument is optional. If present, it must be a Python literal JSON Schema subset:

```python
params={
    "type": "object",
    "properties": {
        "threshold": {
            "type": "number",
            "title": "Threshold",
            "description": "Cutoff value used by the analysis.",
            "default": 0.5,
            "minimum": 0,
            "maximum": 1,
        },
    },
}
```

Supported root shape:

- `type` must be `"object"`
- `properties` must be a mapping

Supported property types:

- `string`
- `number`
- `integer`
- `boolean`

Supported property metadata:

- `title`
- `description`
- `default`
- `enum`
- `minimum`
- `maximum`

Do not use legacy list-shaped params such as `params=[{"name": "threshold", ...}]`.
Do not use `display_name` inside params properties; use `title` instead.

## Minimal Shape

```python
from __future__ import annotations

from typing import Any

from integral import integral_block


@integral_block(
    display_name="Example Block",
    description="Describe the block in one sentence.",
    inputs=[
        {"name": "source", "extensions": [".csv"], "datatype": "user-id/source-table"},
    ],
    outputs=[
        {"name": "report", "extension": ".html", "datatype": "user-id/html-report"},
    ],
    params={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "title": "Report title",
                "default": "Example Report",
            },
        },
    },
)
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    ...
```

## What This Module Does Not Define

The `integral` module does not define:

- manual dataset ID tracking
- CLI argument parsing
- runtime log handling
- note-writing behavior inside Python

Those concerns belong to the runner or to the block implementation, not to the decorator itself.

## Dataset Helpers

For a `.idts` input slot, the runtime passes the `.idts` manifest file path. Use the SDK instead of parsing `.store/.integral` metadata directly:

```python
from integral import integral_block, resolve_dataset_files


def main(inputs, outputs, params) -> None:
    files = resolve_dataset_files(inputs["source"])
```

Available helpers:

- `resolve_dataset_files(path)`: returns member files as `tuple[Path, ...]`
- `resolve_dataset_input(path)`: returns a readable directory for the dataset, materializing source datasets when needed
- `prepare_dataset_output(path)`: creates and returns a `.idts` output directory
