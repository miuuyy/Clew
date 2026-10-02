const fs = require('node:fs');
const path = require('node:path');

function redact(value) {
  return String(value).slice(0, 16384)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/\bBearer\s+[^\s"',}]+/gi, 'Bearer [redacted]')
    .replace(/(\b(?:[\w-]*(?:token|secret|cookie|authorization)|code|state|nonce|sessionToken|x-clew-session)\b["']?\s*[:=]\s*)(?:["'][^"']*["']|[^\s,;&}]+)/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[redacted]')
    .slice(0, 16384);
}

function createLogger(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'desktop.log');
  return value => {
    const line = `${new Date().toISOString()} ${redact(value)}\n`;
    try {
      if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > 4 * 1024 * 1024) {
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, line, { mode: 0o600 });
    } catch {
      // A full disk must not recurse through the fatal-error logger.
      process.stderr.write(line);
    }
  };
}

module.exports = { createLogger, redact };
