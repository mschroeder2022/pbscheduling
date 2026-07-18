// Minimal file + console logger. Writes to logs/agent.log so we can inspect what
// happened during an unattended (post-reboot) run.
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'agent.log');

function ts() {
  return new Date().toISOString();
}

function write(level, ...args) {
  const line = `[${ts()}] [${level}] ${args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

module.exports = {
  info: (...a) => write('INFO', ...a),
  warn: (...a) => write('WARN', ...a),
  error: (...a) => write('ERROR', ...a),
  LOG_FILE,
};
