from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping, Sequence, TypeVar

__all__ = [
    "INTEGRAL_BLOCK_ATTR",
    "IntegralBlockSpec",
    "IntegralSlotSpec",
    "get_integral_block_spec",
    "integral_block",
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
