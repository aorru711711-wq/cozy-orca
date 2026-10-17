#!/usr/bin/env node
/* Dependency-free MCP server (stdio). Lets Claude Desktop tell the ship what it is doing. */
const readline = require('node:readline');
const { report, STATES } = require('../src/claude-status.cjs');

const TOOL = {
  name: 'ship_set_status',
  description: 'Update the Cozy Orca pixel ship. Call with state "working" when you start a task, ' +
    '"needs_input" when you are waiting on the user, "done" when finished, "failed" if it went wrong.',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: [...STATES], description: 'What Claude is doing now.' },
      task: { type: 'string', description: 'Optional short task title.' },
      session: { type: 'string', description: 'Optional chat id, to track several chats at once.' }
    },
    required: ['state']
  }
};

function send(message) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`); }

function handle(msg) {
  const { id, method, params } = msg;
  const wantsReply = id !== undefined && id !== null;
  if (method === 'initialize') {
    return send({ id, result: {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} }, serverInfo: { name: 'cozy-orca-ship', version: '1.3.0' }
    } });
  }
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: [TOOL] } });
  if (method === 'tools/call') {
    if (params?.name !== TOOL.name) return send({ id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
    try {
      const { state, task, session } = params.arguments || {};
      report({ state, task, session });
      return send({ id, result: { content: [{ type: 'text', text: `Ship is now ${state}.` }] } });
    } catch (error) {
      return send({ id, result: { isError: true, content: [{ type: 'text', text: error.message }] } });
    }
  }
  if (wantsReply) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
  try { handle(msg); } catch (error) { if (msg.id != null) send({ id: msg.id, error: { code: -32603, message: error.message } }); }
});
