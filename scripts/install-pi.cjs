/* Thin wrapper. Prefer: npm run connect */
process.argv.splice(2, 0, '--only', 'pi');
const { connect } = require('../src/connect.cjs');
process.exitCode = connect().ok ? 0 : 1;