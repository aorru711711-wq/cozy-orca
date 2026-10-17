# Cozy Orca on Claude Code, Codex, and Antigravity

These agents do not always show up in Orca's fleet feed. A small hook writes the same status file as Claude Desktop and Pi, and the ship sails, waits, or glows from that file. Codex Desktop and the Codex CLI share `~/.codex/hooks.json`. Antigravity and the `agy` CLI share `~/.gemini/config/hooks.json` and `~/.gemini/config/mcp_config.json`. Each session is its own crew member.

## Setup

The easy path connects every agent at once:

```powershell
npm run connect
```

Then restart Claude Code, Codex, and Antigravity/`agy`. If Codex asks you to trust the new hook, allow it, and start the Cozy Orca app.

Only these agents:

```powershell
npm run connect -- --only claude-code,codex,antigravity
```

`agy` is an alias for Antigravity. Remove with `npm run disconnect` or `npm run connect -- --remove --only claude-code,codex,antigravity`.

That writes:

- Claude Code hooks in `~/.claude/settings.json`
- Codex hooks in `~/.codex/hooks.json`
- Antigravity / `agy` hooks in `~/.gemini/config/hooks.json`
- Antigravity MCP in `~/.gemini/config/mcp_config.json`

Existing Orca fleet hooks (for example `orca-status` under Antigravity, or `codex-hook.cmd`) are left in place. The ship can follow both the Orca fleet and this status file at once.

| Event | Ship |
| --- | --- |
| Prompt submitted, tool run, or Antigravity invocation start | sailing |
| Permission request | waiting for you |
| Turn finished | success glow, then idle |
| Turn failed | no glow, error shown |
| Session ended, or Codex interrupted | clears the entry |

The first line of the prompt is the task title when the hook sees one. Antigravity can also call the MCP tool `ship_set_status` to set a short title. Entries older than 30 minutes are ignored. The status file is the one described in [claude-desktop.md](claude-desktop.md).
