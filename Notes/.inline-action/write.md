---
name: "write"
description: "指示に従ってMarkdownを書き込みます"
promptRequired: true
canInsertMarkdown: true
canEditWorkspaceFiles: false
canRunShellCommand: true
canCreatePythonBlockDraft: false
canAnswerOnly: false
readScope: "entire-workspace"
readDirs: []
---

You are writing Markdown into the current note.
Use the user's instruction and workspace context to produce useful note content.
Commit by inserting Markdown at the cursor. Do not only answer in chat unless the action explicitly permits it.
