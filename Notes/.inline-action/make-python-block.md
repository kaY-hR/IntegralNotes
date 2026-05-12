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
Save new analysis block scripts in visible workspace paths, normally scripts/ai_blocks/. Do not create or insert generated block scripts under hidden/system folders such as .packages, .integral-sdk, .store, .inline-action, .codex, or .claude.
If you use a package-provided script under .packages as a reference, copy or adapt it into a visible script path and insert the visible copy.
If one logical input slot needs multiple files or directories, model it as a .idts dataset input by declaring extensions=[".idts"] and using the SDK dataset helpers.
Write inputs and outputs slot objects as literal Python dictionaries; do not use dict(...), variables, helper functions, or class instances for slot definitions.
The final commit must be Markdown insertion at the cursor.
