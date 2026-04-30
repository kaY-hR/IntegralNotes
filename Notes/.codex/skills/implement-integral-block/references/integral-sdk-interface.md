# Integral SDK Interface

Source of truth:

- `../../../scripts/integral/__init__.py`
- `../../../scripts/integral/README.md`

Use this reference when you need to know what the shipped `integral` module actually supports.

## Import

Use:

```python
from integral import integral_block
```

The module also exports `get_integral_block_spec`, `IntegralBlockSpec`, and `IntegralSlotSpec`, but a normal block script usually only needs `integral_block`.

## Decorator Surface

The current decorator accepts only these keyword arguments:

- `display_name`
- `description`
- `inputs`
- `outputs`
- `params`

Do not invent additional decorator fields unless the task explicitly changes `scripts/integral/__init__.py`.

## Slot Forms

Each item inside `inputs` or `outputs` may be either:

- a string shorthand such as `"source"`
- an object with supported keys

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
- `datatype` is a semantic I/O compatibility label. Prefer namespaced values such as `{user-id}/peak-table` when a user ID is available.
- duplicate slot names are rejected case-insensitively.
- boolean fields must be real booleans, not `"true"` or `"false"` strings.
- `project_to_inputs` is removed and raises an error.

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

- a params schema system
- dataset ID handling
- CLI argument parsing
- runtime log handling
- note-writing behavior inside Python

Those concerns belong to the runner or to the block implementation, not to the decorator itself.
