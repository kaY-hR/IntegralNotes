from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Sequence, TypeVar

__all__ = [
    "INTEGRAL_BLOCK_ATTR",
    "IntegralBlockSpec",
    "get_integral_block_spec",
    "integral_block",
]

INTEGRAL_BLOCK_ATTR = "__integral_block__"

TFunc = TypeVar("TFunc", bound=Callable[..., Any])


@dataclass(frozen=True, slots=True)
class IntegralBlockSpec:
    display_name: str | None = None
    description: str = ""
    inputs: tuple[str, ...] = ()
    outputs: tuple[str, ...] = ()


def integral_block(
    *,
    display_name: str | None = None,
    description: str = "",
    inputs: Sequence[str] | None = None,
    outputs: Sequence[str] | None = None,
) -> Callable[[TFunc], TFunc]:
    spec = IntegralBlockSpec(
        display_name=_normalize_optional_string(display_name),
        description=_normalize_optional_string(description) or "",
        inputs=_normalize_slot_names(inputs, field_name="inputs"),
        outputs=_normalize_slot_names(outputs, field_name="outputs"),
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


def _normalize_slot_names(
    values: Sequence[str] | None,
    *,
    field_name: str,
) -> tuple[str, ...]:
    if values is None:
        return ()

    normalized_values: list[str] = []
    seen = set()

    for raw_value in values:
        normalized = str(raw_value).strip()

        if not normalized:
            raise ValueError(f"{field_name} must not contain empty slot names.")

        if normalized in seen:
            raise ValueError(f"{field_name} must not contain duplicate slot names: {normalized}")

        seen.add(normalized)
        normalized_values.append(normalized)

    return tuple(normalized_values)
