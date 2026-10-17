# Cozy Orca on Claude Desktop

Claude Desktop has no Orca-style status feed, so the ship follows it through a tiny MCP server
(`mcp/server.cjs`, no dependencies). Claude calls one tool, `ship_set_status`, and the ship sails,
waits or glows to match. It works alongside Orca: if both are active, the ship shows the combined state.

## Setup

1. Install [Node.js](https://nodejs.org) and clone this repo.
2. Run `node scripts/install-claude-desktop.cjs`. It adds `cozy-orca-ship` to Claude Desktop's
   config and keeps a `.bak` copy. That file is `%APPDATA%\Claude\claude_desktop_config.json`
   on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, and
   `~/.config/Claude/claude_desktop_config.json` on Linux. (`--print` shows the entry instead,
   if you prefer to paste it yourself.)
3. Fully quit and reopen Claude Desktop, then start the Cozy Orca app.
4. Tell Claude once, for example in a Project's instructions:
   *"Call ship_set_status with working when you start a task, needs_input when you wait on me, and done or failed when you finish."*

## States

| `state` | Ship |
| --- | --- |
| `working` | sailing |
| `needs_input` | waiting for you |
| `done` | success glow, then idle |
| `failed` | no glow, error shown |
| `idle` | clears the entry |

Optional `task` (short title) and `session` (chat id, to track several chats) arguments are accepted.
Entries older than 30 minutes are ignored, so a crashed chat never leaves the ship sailing forever.
Status is stored beside Cozy Orca's other per-user files: `%APPDATA%\cozy-orca\claude-status.json` on Windows, `~/Library/Application Support/cozy-orca/claude-status.json` on macOS, and `~/.config/cozy-orca/claude-status.json` on Linux. Override the file with `COZY_CLAUDE_STATUS`.
