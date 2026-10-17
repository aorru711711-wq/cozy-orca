const { report } = require('./claude-status.cjs');

const WORKING = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolBatch', 'PreInvocation']);
const CLEAR = new Set(['SessionEnd', 'Interrupt']);

function firstLine(value) {
  if (typeof value !== 'string') return '';
  return value.split(/\r?\n/, 1)[0].trim();
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : '';
}

/** Map one agent hook payload to a ship update. Null means ignore it. */
function decide(input) {
  const event = input && typeof input.hook_event_name === 'string' ? input.hook_event_name : '';
  if (event === 'Notification') {
    const type = input.notification_type || input.type || '';
    if (type === 'permission_prompt' || type === 'agent_needs_input' || type === 'elicitation_dialog' || type === 'elicitation_url_dialog') {
      return { state: 'needs_input' };
    }
    return null;
  }
  if (event === 'UserPromptSubmit') return { state: 'working', task: firstLine(input.prompt) };
  if (WORKING.has(event)) return { state: 'working' };
  if (event === 'PermissionRequest') return { state: 'needs_input' };
  if (event === 'Stop' || event === 'PostInvocation') return { state: 'done' };
  if (event === 'StopFailure') return { state: 'failed' };
  if (CLEAR.has(event)) return { state: 'idle' };
  return null;
}

function sessionPrefix(source) {
  if (source === 'Codex') return 'cx';
  if (source === 'Antigravity') return 'agy';
  return 'cc';
}

function sessionKey(source, input) {
  const id = input && (typeof input.session_id === 'string' ? input.session_id : input.sessionId);
  return `${sessionPrefix(source)}:${id || 'session'}`;
}

function applyHook({ source, input, file, now }) {
  const update = decide(input);
  if (!update || !source) return null;
  return report({
    file, now, source, state: update.state,
    task: update.task, session: sessionKey(source, input)
  });
}

function readStdin(stream = process.stdin) {
  return new Promise(resolve => {
    let raw = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(raw.slice(0, 1_000_000));
    };
    stream.setEncoding('utf8');
    stream.on('data', chunk => { raw += chunk; });
    stream.on('end', finish);
    stream.on('error', finish);
    setTimeout(finish, 500);
  });
}

async function main(argv = process.argv.slice(2)) {
  const source = flag(argv, '--source');
  const event = flag(argv, '--event');
  if (!source) return;
  let input = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) input = JSON.parse(raw);
  } catch { return; }
  if (event && !input.hook_event_name) input.hook_event_name = event;
  try { applyHook({ source, input }); } catch { /* The ship is optional; never block the agent. */ }
}

if (require.main === module) main();

module.exports = { decide, applyHook, sessionKey, main };
