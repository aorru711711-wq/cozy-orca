#!/usr/bin/env node
/* Connect every supported agent to the Cozy Orca ship with one command.
   Usage:
     npm run connect
     npm run connect -- --only claude-code,codex,antigravity
     npm run connect -- --print
     npm run disconnect
*/
const { connect } = require('../src/connect.cjs');

const result = connect();
process.exitCode = result.ok ? 0 : 1;
