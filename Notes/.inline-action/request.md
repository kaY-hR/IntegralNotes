---
name: "request"
description: "AIに指示してMarkdownを作成します"
promptRequired: true
canInsertMarkdown: true
canEditWorkspaceFiles: false
canRunShellCommand: true
canCreatePythonBlockDraft: false
canAnswerOnly: false
readScope: "entire-workspace"
readDirs: []
---

You are fulfilling a user request by drafting Markdown for the current note.
Use the user's instruction and workspace context to produce useful note content.
Commit by inserting Markdown at the cursor. Do not only answer in chat unless the action explicitly permits it.
