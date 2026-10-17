# Cozy Orca on Claude Code, Codex, and Antigravity

These agents do not always show up in Orca's fleet feed. A small hook writes the same status file as Claude Desktop and Pi, and the ship sails, waits, or glows from that file. Codex Desktop and the Codex CLI share `~/.codex/hooks.json`. Antigravity and the `agy` CLI share `~/.gemini/config/hooks.json` and `~/.gemini/config/mcp_config.json`. Each session is its own crew member.

## Setup

1. Clone this repo and install [Node.js](https://nodejs.org).
2. Run `node scripts/install-hooks.cjs`. It merges hooks for Claude Code, Codex, and Antigravity, adds the Cozy Orca MCP server to Antigravity, and keeps a `.bak` of each file it changes. (`--print` shows the paths. `--remove` deletes only these hooks and the Antigravity MCP entry.)
3. Restart Claude Code, Codex, and Antigravity/`agy`. If Codex asks you to trust the new hook, allow it.
4. Start the Cozy Orca app.

Existing Orca fleet hooks (for example `orca-status` under Antigravity, or `codex-hook.cmd`) are left in place. The ship can follow both the Orca fleet and this status file at once.

| Event | Ship |
| --- | --- |
| Prompt submitted, tool run, or Antigravity invocation start | sailing |
| Permission request | waiting for you |
| Turn finished | success glow, then idle |
| Turn failed | no glow, error shown |
| Session ended, or Codex interrupted | clears the entry |

The first line of the prompt is the task title when the hook sees one. Antigravity can also call the MCP tool `ship_set_status` to set a short title. Entries older than 30 minutes are ignored. The status file is the one described in [claude-desktop.md](claude-desktop.md).
