---
name: vscode-extensions
description: Agent commands for the VS Code extensions in this monorepo. Use when a task involves one of the extensions listed below. Read the linked file for the extension you need.
---

# VS Code extensions: skill catalog

This file only lists the extensions and links to their skill files. Open the file for the extension your task involves. Don't load the others.

Each extension exposes non-interactive agent commands named `<extensionId>.agent.<verb>`. Call them with `vscode.commands.executeCommand(id, ...args)`. Each file documents the commands, arguments, results and failure cases for its extension.

| Extension | Use it when | Skill file |
| --- | --- | --- |
| Run Config (`runConfig`) | Running, adding or removing project scripts, Spring Boot apps and run configurations | [run-config.md](run-config.md) |
