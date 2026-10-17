// Cozy Orca ship status for the Pi coding agent. Install with: node scripts/install-pi.cjs
// Writes the same status file the Claude Desktop MCP server uses; the ship reads it.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const STATUS_FILE = process.env.COZY_CLAUDE_STATUS || path.join(
  process.platform === "win32" ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support")
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "cozy-orca", "claude-status.json")
const SESSION = `pi-${process.pid}`

function report(state: "working" | "done" | "failed" | "idle", task?: string): void {
  try {
    let data: { sessions: Record<string, any> } = { sessions: {} }
    try {
      const parsed = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"))
      if (parsed && typeof parsed.sessions === "object" && !Array.isArray(parsed.sessions)) data = parsed
    } catch { /* missing or damaged file means no other agents */ }
    const now = Date.now()
    const previous = data.sessions[SESSION]
    if (state === "idle") delete data.sessions[SESSION]
    else data.sessions[SESSION] = {
      state, source: "Pi",
      task: (task || previous?.task || "").replace(/\s+/g, " ").trim().slice(0, 160),
      startedAt: previous?.state === state ? previous.startedAt : now, updatedAt: now
    }
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true })
    fs.writeFileSync(`${STATUS_FILE}.${process.pid}.tmp`, JSON.stringify(data, null, 2))
    fs.renameSync(`${STATUS_FILE}.${process.pid}.tmp`, STATUS_FILE)
  } catch { /* the ship is optional; never disturb Pi */ }
}

export default function (pi: any) {
  pi.on("agent_start", () => report("working"))
  pi.on("agent_end", (event: any) => {
    const last = Array.isArray(event?.messages) ? event.messages[event.messages.length - 1] : null
    report(last?.stopReason === "error" ? "failed" : "done")
  })
  pi.on("session_shutdown", () => report("idle"))
}
