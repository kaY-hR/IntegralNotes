#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
import time


def _fallback_bell(count: int, pause_ms: int) -> None:
    for index in range(count):
        sys.stdout.write("\a")
        sys.stdout.flush()
        if index + 1 < count:
            time.sleep(pause_ms / 1000)


def _play_windows_pattern(event: str) -> bool:
    try:
        import winsound
    except ImportError:
        return False

    if event == "done":
        pattern = [
            ("alias", "SystemAsterisk"),
            ("sleep", 140),
            ("alias", "SystemAsterisk"),
        ]
    else:
        pattern = [
            ("alias", "SystemExclamation"),
            ("sleep", 120),
            ("alias", "SystemExclamation"),
            ("sleep", 120),
            ("alias", "SystemExclamation"),
        ]

    for action, value in pattern:
        if action == "alias":
            winsound.PlaySound(value, winsound.SND_ALIAS)
        else:
            time.sleep(value / 1000)

    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Emit a short notification sound for Codex skill workflows."
    )
    parser.add_argument(
        "--event",
        choices=("done", "question"),
        default="done",
        help="Notification pattern to play.",
    )
    args = parser.parse_args()

    played = _play_windows_pattern(args.event)
    if not played:
        count = 2 if args.event == "done" else 3
        _fallback_bell(count=count, pause_ms=120)

    print(f"beep:{args.event}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
