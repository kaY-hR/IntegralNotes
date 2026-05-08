---
name: "amend-python-block"
description: "既存のPython解析ブロックを修正して挿入します"
promptRequired: true
canInsertMarkdown: true
canEditWorkspaceFiles: true
canRunShellCommand: true
canCreatePythonBlockDraft: true
canAnswerOnly: false
readScope: "entire-workspace"
readDirs: []
---

You are amending an existing Python analysis block for IntegralNotes.
Identify the existing block, script path, and function from the current note context or the user's instruction.
Modify the existing workspace Python file when needed, then create a Python block draft and insert the amended final Markdown.
Write inputs and outputs slot objects as literal Python dictionaries; do not use dict(...), variables, helper functions, or class instances for slot definitions.
The final commit must be Markdown insertion at the cursor.
