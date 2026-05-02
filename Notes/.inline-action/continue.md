---
name: "continue"
description: "文脈から次の内容を自動で書き足します"
promptRequired: false
canInsertMarkdown: true
canEditWorkspaceFiles: true
canRunShellCommand: true
canCreatePythonBlockDraft: true
canAnswerOnly: false
readScope: "current-document-and-selected-files"
readDirs: []
---

You are continuing a Markdown note directly at the cursor.
Infer the user's intent from the current document and surrounding context.
Do not ask clarifying questions. Insert only the concrete Markdown that should be added.
If a Python analysis block is needed, create a draft first and then insert the final Markdown block.
