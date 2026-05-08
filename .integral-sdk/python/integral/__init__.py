from __future__ import annotations

import json
import os
import shutil
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

__all__ = [
    "IntegralDatasetInput",
    "IntegralDatasetMember",
    "INTEGRAL_BLOCK_ATTR",
    "IntegralBlockSpec",
    "IntegralSlotSpec",
    "get_integral_block_spec",
    "integral_block",
    "prepare_dataset_output",
    "resolve_dataset_files",
    "resolve_dataset_input",
]

INTEGRAL_BLOCK_ATTR = "__integral_block__"

TFunc = TypeVar("TFunc", bound=Callable[..., Any])


@dataclass(frozen=True, slots=True)
class IntegralSlotSpec:
    name: str
    extensions: tuple[str, ...] = ()
    datatype: str | None = None
    auto_insert_to_work_note: bool = False
    share_note_with_input: str | None = None
    embed_to_shared_note: bool = False


@dataclass(frozen=True, slots=True)
class IntegralBlockSpec:
    display_name: str | None = None
    description: str = ""
    inputs: tuple[IntegralSlotSpec, ...] = ()
    outputs: tuple[IntegralSlotSpec, ...] = ()
    params: Mapping[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class IntegralDatasetMember:
    managed_file_id: str
    path: Path
    display_name: str
    representation: str


@dataclass(frozen=True, slots=True)
class IntegralDatasetInput:
    manifest_path: Path
    workspace_root: Path
    dataset_id: str
    name: str
    data_path: Path | None = None
    members: tuple[IntegralDatasetMember, ...] = ()

    @property
    def files(self) -> tuple[Path, ...]:
        if self.data_path is not None:
            return tuple(
                path
                for path in sorted(self.data_path.rglob("*"))
                if path.is_file() and path.suffix.lower() != ".idts"
            )

        files: list[Path] = []
        for member in self.members:
            if member.representation == "directory":
                files.extend(path for path in sorted(member.path.rglob("*")) if path.is_file())
            elif member.path.is_file():
                files.append(member.path)

        return tuple(files)


def integral_block(
    *,
    display_name: str | None = None,
    description: str = "",
    inputs: Sequence[str | Mapping[str, Any]] | None = None,
    outputs: Sequence[str | Mapping[str, Any]] | None = None,
    params: Mapping[str, Any] | None = None,
) -> Callable[[TFunc], TFunc]:
    spec = IntegralBlockSpec(
        display_name=_normalize_optional_string(display_name),
        description=_normalize_optional_string(description) or "",
        inputs=_normalize_slots(inputs, field_name="inputs"),
        outputs=_normalize_slots(outputs, field_name="outputs"),
        params=_normalize_params_schema(params),
    )

    def decorator(func: TFunc) -> TFunc:
        setattr(func, INTEGRAL_BLOCK_ATTR, spec)
        return func

    return decorator


def get_integral_block_spec(value: Any) -> IntegralBlockSpec | None:
    spec = getattr(value, INTEGRAL_BLOCK_ATTR, None)
    return spec if isinstance(spec, IntegralBlockSpec) else None


def resolve_dataset_input(value: str | os.PathLike[str] | None) -> Path:
    """Return a readable directory for a .idts dataset input.

    IntegralNotes passes .idts input slots as manifest file paths. Use this helper
    when a script wants a directory that can be globbed. Source datasets without a
    dataPath are materialized under .store/.integral/materialized-datasets using
    copies, so treat the returned directory as read-only scratch input.
    """
    dataset = _read_dataset_input(value)

    if dataset.data_path is not None:
        return dataset.data_path

    return _materialize_dataset_members(dataset)


def resolve_dataset_files(value: str | os.PathLike[str] | None) -> tuple[Path, ...]:
    """Return member files for a .idts dataset input."""
    return _read_dataset_input(value).files


def prepare_dataset_output(value: str | os.PathLike[str] | None) -> Path:
    """Return and create the directory path supplied for a .idts output slot."""
    if value is None:
        raise ValueError("Dataset output path is required.")

    output_path = Path(value)
    output_path.mkdir(parents=True, exist_ok=True)
    return output_path


def _normalize_optional_string(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = str(value).strip()
    return normalized if normalized else None


def _normalize_slots(
    values: Sequence[str | Mapping[str, Any]] | None,
    *,
    field_name: str,
) -> tuple[IntegralSlotSpec, ...]:
    if values is None:
        return ()

    normalized_values: list[IntegralSlotSpec] = []
    seen = set()

    for raw_value in values:
        slot = _normalize_slot(raw_value, field_name=field_name)
        normalized = slot.name

        if normalized.lower() in seen:
            raise ValueError(f"{field_name} must not contain duplicate slot names: {normalized}")

        seen.add(normalized.lower())
        normalized_values.append(slot)

    return tuple(normalized_values)


def _normalize_slot(
    value: str | Mapping[str, Any],
    *,
    field_name: str,
) -> IntegralSlotSpec:
    if isinstance(value, str):
        name = _normalize_slot_name(value, field_name=field_name)
        return IntegralSlotSpec(name=name)

    if not isinstance(value, Mapping):
        raise ValueError(f"{field_name} must contain slot name strings or mapping objects.")

    if "project_to_inputs" in value:
        raise ValueError(
            "project_to_inputs has been removed. Use share_note_with_input and embed_to_shared_note instead."
        )

    name = _normalize_slot_name(value.get("name"), field_name=field_name)
    extension = _normalize_extension(value.get("extension"))
    extensions = _normalize_extensions(value.get("extensions"))

    if extension is not None:
        extensions = (extension, *tuple(item for item in extensions if item != extension))

    return IntegralSlotSpec(
        name=name,
        extensions=extensions,
        datatype=_normalize_optional_string(value.get("datatype")),
        auto_insert_to_work_note=_normalize_bool(
            value.get("auto_insert_to_work_note"),
            field_name="auto_insert_to_work_note",
        ),
        share_note_with_input=_normalize_optional_slot_name(
            value.get("share_note_with_input"),
            field_name="share_note_with_input",
        ),
        embed_to_shared_note=_normalize_bool(
            value.get("embed_to_shared_note"),
            field_name="embed_to_shared_note",
        ),
    )


def _normalize_slot_name(value: Any, *, field_name: str) -> str:
    normalized = str(value).strip()

    if not normalized:
        raise ValueError(f"{field_name} must not contain empty slot names.")

    return normalized


def _normalize_extension(value: Any) -> str | None:
    if value is None:
        return None

    normalized = str(value).strip().lower()

    if not normalized:
        return None

    return normalized if normalized.startswith(".") else f".{normalized}"


def _normalize_extensions(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()

    if isinstance(value, str):
        normalized = _normalize_extension(value)
        return (normalized,) if normalized is not None else ()

    if not isinstance(value, Sequence):
        raise ValueError("extensions must be a string or a sequence of strings.")

    normalized_values: list[str] = []
    seen = set()

    for candidate in value:
        normalized = _normalize_extension(candidate)

        if normalized is None or normalized in seen:
            continue

        seen.add(normalized)
        normalized_values.append(normalized)

    return tuple(normalized_values)


def _normalize_bool(value: Any, *, field_name: str) -> bool:
    if value is None:
        return False

    if isinstance(value, bool):
        return value

    raise ValueError(f"{field_name} must be a boolean.")


def _normalize_params_schema(value: Mapping[str, Any] | None) -> Mapping[str, Any] | None:
    if value is None:
        return None

    if not isinstance(value, Mapping):
        raise ValueError("params must be a JSON Schema-like mapping.")

    if value.get("type") != "object":
        raise ValueError("params must be an object schema.")

    properties = value.get("properties")

    if not isinstance(properties, Mapping):
        raise ValueError("params.properties must be a mapping.")

    return dict(value)


def _normalize_optional_slot_name(value: Any, *, field_name: str) -> str | None:
    if value is None:
        return None

    return _normalize_slot_name(value, field_name=field_name)


def _read_dataset_input(value: str | os.PathLike[str] | None) -> IntegralDatasetInput:
    if value is None:
        raise ValueError("Dataset input path is required.")

    manifest_path = Path(value)

    if not manifest_path.exists():
        raise FileNotFoundError(f"Dataset manifest does not exist: {manifest_path}")

    if not manifest_path.is_file():
        raise IsADirectoryError(
            "Dataset inputs are .idts manifest paths. "
            f"Use resolve_dataset_input() only with a .idts file: {manifest_path}"
        )

    with manifest_path.open("r", encoding="utf-8") as stream:
        manifest = json.load(stream)

    if not isinstance(manifest, Mapping):
        raise ValueError(f"Invalid dataset manifest: {manifest_path}")

    dataset_id = _require_string(manifest.get("datasetId"), "datasetId")
    name = _require_string(manifest.get("name"), "name")
    workspace_root = _find_workspace_root(manifest_path)

    data_path_value = manifest.get("dataPath")
    data_path = None
    if isinstance(data_path_value, str) and data_path_value.strip():
        data_path = workspace_root / _normalize_relative_path(data_path_value)

    members: list[IntegralDatasetMember] = []
    member_ids = manifest.get("memberIds")

    if isinstance(member_ids, Sequence) and not isinstance(member_ids, (str, bytes, bytearray)):
        for raw_member_id in member_ids:
            if not isinstance(raw_member_id, str) or not raw_member_id.strip():
                continue

            metadata = _read_managed_file_metadata(workspace_root, raw_member_id.strip())
            if metadata is None:
                continue

            member_path_value = _require_string(metadata.get("path"), "path")
            member_path = workspace_root / _normalize_relative_path(member_path_value)
            members.append(
                IntegralDatasetMember(
                    managed_file_id=raw_member_id.strip(),
                    path=member_path,
                    display_name=str(metadata.get("displayName") or member_path.name),
                    representation=str(metadata.get("representation") or "file"),
                )
            )

    return IntegralDatasetInput(
        manifest_path=manifest_path,
        workspace_root=workspace_root,
        dataset_id=dataset_id,
        name=name,
        data_path=data_path,
        members=tuple(members),
    )


def _find_workspace_root(path_value: Path) -> Path:
    start = path_value.resolve()

    for candidate in (start.parent, *start.parents):
        if (candidate / ".store" / ".integral").is_dir():
            return candidate

    raise FileNotFoundError(
        "Could not locate IntegralNotes workspace root from dataset path: "
        f"{path_value}"
    )


def _read_managed_file_metadata(
    workspace_root: Path,
    managed_file_id: str,
) -> Mapping[str, Any] | None:
    metadata_path = workspace_root / ".store" / ".integral" / f"{managed_file_id}.json"

    if not metadata_path.exists():
        return None

    with metadata_path.open("r", encoding="utf-8") as stream:
        metadata = json.load(stream)

    return metadata if isinstance(metadata, Mapping) else None


def _materialize_dataset_members(dataset: IntegralDatasetInput) -> Path:
    target_root = (
        dataset.workspace_root
        / ".store"
        / ".integral"
        / "materialized-datasets"
        / dataset.dataset_id
    )

    if target_root.exists():
        shutil.rmtree(target_root)

    target_root.mkdir(parents=True, exist_ok=True)

    used_names: set[str] = set()
    for member in dataset.members:
        entry_name = _create_unique_entry_name(member.display_name, member.managed_file_id, used_names)
        target_path = target_root / entry_name

        if member.representation == "directory" and member.path.is_dir():
            shutil.copytree(member.path, target_path)
            continue

        if member.path.is_file():
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(member.path, target_path)

    return target_root


def _create_unique_entry_name(display_name: str, managed_file_id: str, used_names: set[str]) -> str:
    candidate = Path(display_name).name or managed_file_id

    if candidate not in used_names:
        used_names.add(candidate)
        return candidate

    suffix = f"_{managed_file_id}"
    path_candidate = Path(candidate)
    stem = path_candidate.stem or candidate
    extension = path_candidate.suffix
    next_candidate = f"{stem}{suffix}{extension}"

    serial = 2
    while next_candidate in used_names:
        next_candidate = f"{stem}{suffix}_{serial}{extension}"
        serial += 1

    used_names.add(next_candidate)
    return next_candidate


def _normalize_relative_path(value: str) -> Path:
    normalized = value.replace("\\", "/").lstrip("/")
    return Path(*[segment for segment in normalized.split("/") if segment])


def _require_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Dataset manifest field '{field_name}' must be a non-empty string.")

    return value.strip()
