# Cozy Orca on Pi

The ship follows the [Pi coding agent](https://pi.dev) through a small Pi extension (`extensions/pi-cozy-orca.ts`).
It needs no Orca. It works alongside Orca and Claude Desktop, and the ship shows the combined state.

## Setup

The easy path connects Pi with every other supported agent:

```powershell
npm run connect
```

Only Pi:

```powershell
npm run connect -- --only pi
```

That copies the extension to `~/.pi/agent/extensions/cozy-orca-ship.ts`. Restart Pi (or run `/reload`), then start the Cozy Orca app.

Remove with `npm run connect -- --remove --only pi`.

| Pi event | Ship |
| --- | --- |
| `agent_start` | sailing |
| `agent_end` | success glow, then idle (error shown if the run failed) |
| `session_shutdown` | clears the entry |

Each Pi process is its own crew member. Entries older than 30 minutes are ignored. The status file is the one described in [claude-desktop.md](claude-desktop.md).
