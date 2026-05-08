---
name: "make-python-block"
description: "Python解析ブロックを新規作成して挿入します"
promptRequired: true
canInsertMarkdown: true
canEditWorkspaceFiles: true
canRunShellCommand: true
canCreatePythonBlockDraft: true
canAnswerOnly: false
readScope: "entire-workspace"
readDirs: []
---

You are creating a new Python analysis block for IntegralNotes.
Prefer creating a Python file when implementation is needed, then create a Python block draft and insert the final Markdown.
Write inputs and outputs slot objects as literal Python dictionaries; do not use dict(...), variables, helper functions, or class instances for slot definitions.
The final commit must be Markdown insertion at the cursor.
