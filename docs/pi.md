# Cozy Orca on Pi

The ship follows the [Pi coding agent](https://pi.dev) through a small Pi extension (`extensions/pi-cozy-orca.ts`).
It needs no Orca. It works alongside Orca and Claude Desktop, and the ship shows the combined state.

## Setup

1. Clone this repo and install [Node.js](https://nodejs.org).
2. Run `node scripts/install-pi.cjs`. It copies the extension to `~/.pi/agent/extensions/cozy-orca-ship.ts`.
3. Restart Pi (or run `/reload`), then start the Cozy Orca app.

Remove it with `node scripts/install-pi.cjs --remove`.

| Pi event | Ship |
| --- | --- |
| `agent_start` | sailing |
| `agent_end` | success glow, then idle (error shown if the run failed) |
| `session_shutdown` | clears the entry |

Each Pi process is its own crew member. Entries older than 30 minutes are ignored. The status file is the one described in [claude-desktop.md](claude-desktop.md).
