/* Adds the Cozy Orca MCP server to Claude Desktop's config. `--print` shows the entry without writing. */
const fs = require('node:fs');
const path = require('node:path');

const entry = { command: process.execPath, args: [path.resolve(__dirname, '..', 'mcp', 'server.cjs')] };
if (process.argv.includes('--print')) {
  console.log(JSON.stringify({ mcpServers: { 'cozy-orca-ship': entry } }, null, 2));
  process.exit(0);
}
const file = process.env.CLAUDE_DESKTOP_CONFIG ||
  path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') { console.error(`Could not read ${file}: ${error.message}`); process.exit(1); }
}
if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
config.mcpServers = { ...config.mcpServers, 'cozy-orca-ship': entry };
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(config, null, 2));
console.log(`Added cozy-orca-ship to ${file}. Fully quit and reopen Claude Desktop.`);
