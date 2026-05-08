from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


APP_DISCOVERY_PATTERN = re.compile(
    r"@integral_block\s*\(([\s\S]*?)\)\s*(?:\r?\n)+\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(",
    re.MULTILINE,
)

ALLOWED_DECORATOR_KEYS = {"display_name", "description", "inputs", "outputs", "params"}
SUPPORTED_SLOT_KEYS = {
    "name",
    "extension",
    "extensions",
    "datatype",
    "auto_insert_to_work_note",
    "share_note_with_input",
    "embed_to_shared_note",
}
SUPPORTED_PARAM_TYPES = {"boolean", "integer", "number", "string"}


@dataclass
class Issue:
    severity: str
    path: Path
    line: int
    column: int
    message: str

    def format(self) -> str:
        return f"{self.path}:{self.line}:{self.column}: {self.severity}: {self.message}"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            "usage: python validate_integral_block.py <script.py> [<script.py> ...]",
            file=sys.stderr,
        )
        return 2

    issues: list[Issue] = []
    checked_blocks = 0

    for raw_path in argv[1:]:
        path = Path(raw_path)
        file_issues, block_count = validate_file(path)
        issues.extend(file_issues)
        checked_blocks += block_count

    for issue in sorted(issues, key=lambda item: (str(item.path), item.line, item.column, item.severity)):
        print(issue.format(), file=sys.stderr)

    error_count = sum(1 for issue in issues if issue.severity == "error")
    warning_count = sum(1 for issue in issues if issue.severity == "warning")

    if error_count:
        print(
            f"FAILED: {error_count} error(s), {warning_count} warning(s), {checked_blocks} block(s) checked.",
            file=sys.stderr,
        )
        return 1

    print(f"OK: {checked_blocks} block(s) checked, {warning_count} warning(s).")
    return 0


def validate_file(path: Path) -> tuple[list[Issue], int]:
    issues: list[Issue] = []

    try:
        source = path.read_text(encoding="utf-8")
    except OSError as exc:
        return ([Issue("error", path, 1, 1, f"cannot read file: {exc}")], 0)

    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        return (
            [
                Issue(
                    "error",
                    path,
                    exc.lineno or 1,
                    (exc.offset or 1),
                    exc.msg,
                )
            ],
            0,
        )

    app_discovered_names = {match.group(2) for match in APP_DISCOVERY_PATTERN.finditer(source)}
    block_count = 0

    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue

        decorator = find_integral_block_decorator(node)
        if decorator is None:
            continue

        block_count += 1

        if node.name not in app_discovered_names:
            issues.append(
                issue(
                    path,
                    node,
                    "error",
                    "@integral_block(...) must be immediately above the function definition for app discovery.",
                )
            )

        validate_signature(path, node, issues)
        validate_decorator(path, decorator, issues)

    if block_count == 0:
        issues.append(Issue("error", path, 1, 1, "no top-level @integral_block(...) function found."))

    return issues, block_count


def find_integral_block_decorator(node: ast.FunctionDef) -> ast.Call | None:
    for decorator in node.decorator_list:
        if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Name):
            if decorator.func.id == "integral_block":
                return decorator

    return None


def validate_signature(path: Path, node: ast.FunctionDef, issues: list[Issue]) -> None:
    positional_args = [*node.args.posonlyargs, *node.args.args]
    positional_names = [arg.arg for arg in positional_args]

    if node.name != "main":
        issues.append(
            issue(
                path,
                node,
                "warning",
                "block callable is usually named main; use another name only when intentional.",
            )
        )

    if positional_names[:3] != ["inputs", "outputs", "params"]:
        issues.append(
            issue(
                path,
                node,
                "error",
                "callable signature must start with inputs, outputs, params.",
            )
        )

    required_positional_count = len(positional_args) - len(node.args.defaults)
    if required_positional_count > 3:
        issues.append(
            issue(
                path,
                positional_args[3],
                "error",
                "callable must not require positional arguments after inputs, outputs, params.",
            )
        )


def validate_decorator(path: Path, decorator: ast.Call, issues: list[Issue]) -> None:
    seen_keywords: set[str] = set()

    for keyword in decorator.keywords:
        if keyword.arg is None:
            issues.append(issue(path, keyword.value, "error", "decorator must not use **kwargs."))
            continue

        if keyword.arg not in ALLOWED_DECORATOR_KEYS:
            issues.append(
                issue(
                    path,
                    keyword.value,
                    "error",
                    f"unsupported decorator keyword: {keyword.arg}",
                )
            )
            continue

        if keyword.arg in seen_keywords:
            issues.append(issue(path, keyword.value, "error", f"duplicate decorator keyword: {keyword.arg}"))
            continue

        seen_keywords.add(keyword.arg)

        if keyword.arg in {"inputs", "outputs"}:
            validate_slots(path, keyword.value, keyword.arg, issues)
        elif keyword.arg == "params":
            validate_params(path, keyword.value, issues)


def validate_slots(path: Path, value: ast.AST, field_name: str, issues: list[Issue]) -> None:
    if not isinstance(value, ast.List):
        issues.append(
            issue(
                path,
                value,
                "error",
                f"{field_name} must be a literal list for app discovery.",
            )
        )
        return

    seen_names: set[str] = set()

    for item in value.elts:
        if isinstance(item, ast.Constant) and isinstance(item.value, str):
            name = item.value.strip()
            if not name:
                issues.append(issue(path, item, "error", f"{field_name} must not contain empty slot names."))
                continue
            check_duplicate_slot(path, item, field_name, name, seen_names, issues)
            continue

        if isinstance(item, ast.Call):
            issues.append(
                issue(
                    path,
                    item,
                    "error",
                    f"{field_name} slot definitions must be literal {{...}} mappings, not function calls such as dict(...).",
                )
            )
            continue

        if not isinstance(item, ast.Dict):
            issues.append(
                issue(
                    path,
                    item,
                    "error",
                    f"{field_name} entries must be string shorthand or literal {{...}} mappings.",
                )
            )
            continue

        validate_slot_mapping(path, item, field_name, seen_names, issues)


def validate_slot_mapping(
    path: Path,
    item: ast.Dict,
    field_name: str,
    seen_names: set[str],
    issues: list[Issue],
) -> None:
    slot: dict[str, ast.AST] = {}

    for raw_key, raw_value in zip(item.keys, item.values):
        if not isinstance(raw_key, ast.Constant) or not isinstance(raw_key.value, str):
            issues.append(issue(path, raw_key or item, "error", "slot mapping keys must be string literals."))
            continue

        key = raw_key.value

        if key not in SUPPORTED_SLOT_KEYS:
            issues.append(issue(path, raw_key, "error", f"unsupported slot key: {key}"))
            continue

        if key in slot:
            issues.append(issue(path, raw_key, "error", f"duplicate slot key: {key}"))
            continue

        slot[key] = raw_value

    name_node = slot.get("name")
    name = literal_string(name_node)

    if not name:
        issues.append(issue(path, name_node or item, "error", "slot mapping requires a non-empty string name."))
    else:
        check_duplicate_slot(path, name_node or item, field_name, name, seen_names, issues)

    validate_optional_string(path, slot, "extension", issues)
    validate_optional_string(path, slot, "datatype", issues)
    validate_optional_string(path, slot, "share_note_with_input", issues)
    validate_extensions(path, slot.get("extensions"), issues)
    validate_optional_bool(path, slot, "auto_insert_to_work_note", issues)
    validate_optional_bool(path, slot, "embed_to_shared_note", issues)

    if field_name == "outputs" and "extensions" in slot and "extension" not in slot:
        issues.append(
            issue(
                path,
                slot["extensions"],
                "warning",
                "single-file output slots should prefer extension over extensions.",
            )
        )


def check_duplicate_slot(
    path: Path,
    node: ast.AST,
    field_name: str,
    name: str,
    seen_names: set[str],
    issues: list[Issue],
) -> None:
    normalized = name.lower()

    if normalized in seen_names:
        issues.append(issue(path, node, "error", f"duplicate {field_name} slot name: {name}"))
        return

    seen_names.add(normalized)


def validate_optional_string(
    path: Path,
    slot: dict[str, ast.AST],
    key: str,
    issues: list[Issue],
) -> None:
    if key not in slot:
        return

    if literal_string(slot[key]) is None:
        issues.append(issue(path, slot[key], "error", f"slot {key} must be a string literal."))


def validate_extensions(path: Path, value: ast.AST | None, issues: list[Issue]) -> None:
    if value is None:
        return

    if not isinstance(value, ast.List):
        issues.append(issue(path, value, "error", "slot extensions must be a literal list of strings."))
        return

    for item in value.elts:
        if literal_string(item) is None:
            issues.append(issue(path, item, "error", "slot extensions must contain only string literals."))


def validate_optional_bool(
    path: Path,
    slot: dict[str, ast.AST],
    key: str,
    issues: list[Issue],
) -> None:
    if key not in slot:
        return

    node = slot[key]
    if not isinstance(node, ast.Constant) or not isinstance(node.value, bool):
        issues.append(issue(path, node, "error", f"slot {key} must be a boolean literal."))


def validate_params(path: Path, value: ast.AST, issues: list[Issue]) -> None:
    try:
        params = ast.literal_eval(value)
    except (ValueError, SyntaxError):
        issues.append(issue(path, value, "error", "params must be a Python literal object schema."))
        return

    if not isinstance(params, dict):
        issues.append(issue(path, value, "error", "params must be a mapping."))
        return

    if params.get("type") != "object":
        issues.append(issue(path, value, "error", 'params.type must be "object".'))
        return

    properties = params.get("properties")
    if not isinstance(properties, dict):
        issues.append(issue(path, value, "error", "params.properties must be a mapping."))
        return

    for name, property_schema in properties.items():
        if not isinstance(name, str) or not name.strip():
            issues.append(issue(path, value, "error", "params property names must be non-empty strings."))
            continue

        if not isinstance(property_schema, dict):
            issues.append(issue(path, value, "error", f"params property {name!r} must be a mapping."))
            continue

        property_type = property_schema.get("type")
        if property_type not in SUPPORTED_PARAM_TYPES:
            issues.append(
                issue(
                    path,
                    value,
                    "error",
                    f"params property {name!r} has unsupported type: {property_type!r}",
                )
            )


def literal_string(value: ast.AST | None) -> str | None:
    if isinstance(value, ast.Constant) and isinstance(value.value, str):
        normalized = value.value.strip()
        return normalized or None

    return None


def issue(path: Path, node: ast.AST, severity: str, message: str) -> Issue:
    return Issue(
        severity=severity,
        path=path,
        line=getattr(node, "lineno", 1),
        column=getattr(node, "col_offset", 0) + 1,
        message=message,
    )


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
