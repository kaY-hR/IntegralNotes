---
name: beep
description: Play a short beep before the final response when work is done, or before asking the user a question. Use when the user asks for beep or sound notifications.
---

Use this skill when the user wants an audible notification.

Play a sound at these points:

- Right before the final response after the work is complete
- Right before asking the user a question and waiting for a reply

Steps:

1. Run `python .\.codex\skills\beep\scripts\beep.py --event done` for a completion notice.
2. Run `python .\.codex\skills\beep\scripts\beep.py --event question` before a user-facing question.
3. Send the final response or question immediately after the sound.

Notes:

- The helper uses `winsound` on Windows.
- If the command fails, continue normally instead of blocking on the sound.
