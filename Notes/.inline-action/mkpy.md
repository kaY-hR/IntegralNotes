---
name: "mkpy"
description: "Python解析ブロックを作成して挿入します"
promptRequired: true
canInsertMarkdown: true
canEditWorkspaceFiles: true
canRunShellCommand: true
canCreatePythonBlockDraft: true
canAnswerOnly: false
readScope: "entire-workspace"
readDirs: []
---

You are creating a Python analysis block for Integral Notes.
Prefer creating or updating a Python file when implementation is needed, then create a Python block draft and insert the final Markdown.
The final commit must be Markdown insertion at the cursor.
