# Block Implementation Patterns

Use this reference when writing or revising the Python file behind an `@integral_block`.

Examples in this package:

- `../../../demo_hello_report.py`
- `../../../demo_dataset_report.py`
- `../../../src/lc_text_to_chromatogram_json.py`
- `../../../src/chromatogram_pca.py`

## Runtime Contract

Implement the callable as:

```python
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    ...
```

Interpret the arguments like this:

- non-`.idts` `inputs[slot]`: a file path or `None`
- `.idts` `inputs[slot]`: a readable directory path or `None`
- non-`.idts` `outputs[slot]`: a file path reserved for the output file or `None`
- `.idts` `outputs[slot]`: a writable directory path reserved for bundle contents or `None`
- `params`: a free-form object or `None`

Write files to the assigned paths. Do not return in-memory objects to the app.

## Minimal Patterns

Single output file:

```python
report_path = require_output_file(outputs, "report")
options = params or {}
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text("...", encoding="utf-8")
```

Bundle input to bundle output:

```python
source_root = require_existing_directory(inputs, "source")
report_root = require_output_directory(outputs, "report")
report_root.mkdir(parents=True, exist_ok=True)
(report_root / "index.html").write_text("...", encoding="utf-8")
```

Required path helpers should fail clearly:

- missing slot value: `ValueError`
- required file missing: `FileNotFoundError`
- expected directory but got file: `NotADirectoryError`

## Import Strategy

The bundled runtime is expected to make `scripts/integral/` importable, so the normal import is:

```python
from integral import integral_block
```

If the block lives in a nested folder and should also run directly from the command line or stay IDE-friendly outside the app, reuse the bootstrap pattern from `../../../src/*.py` to prepend the local `scripts/` directory to `sys.path` before importing `integral`.

## Output Metadata

Use output slot metadata only when the behavior is intentional:

- `auto_insert_to_work_note=True`: place a user-facing renderable right under the block
- `share_note_with_input="source"`: reuse the input's data-note target
- `embed_to_shared_note=True`: append provenance and `![]()` to the shared data-note

The Python script itself should still focus on file generation. Do not hand-write work-note or data-note Markdown from inside the block.

## Heuristics

- Keep slot names short and literal.
- Use `options = params or {}` before reading params.
- Prefer UTF-8 text output.
- Emit at least one renderable artifact when the result is meant for humans.
- Keep filenames inside bundle outputs stable, such as `index.html`, `summary.json`, `README.txt`, or `scores.csv`.
- Keep the decorator directly above the top-level function so discovery remains simple.

## Common Mistakes

- expecting dataset IDs instead of resolved paths
- reading `analysis-args.json` inside the user script
- assuming every slot is a directory
- writing outside the assigned output path or bundle directory
- inventing unsupported decorator fields
- passing strings instead of booleans for output slot flags
