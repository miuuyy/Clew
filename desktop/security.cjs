const APP_ORIGIN = 'clew://app';
const APP_URL = `${APP_ORIGIN}/`;

function applicationUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'clew:' && url.host === 'app' && !url.username && !url.password;
  } catch { return false; }
}

function externalUrl(value) {
  if (typeof value !== 'string' || value.length > 16384) throw new Error('Invalid external link.');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only web links can be opened.');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('External links must use HTTPS.');
  return url.href;
}

function trustedFrame(event, contents) {
  // URL.origin is "null" for custom schemes in Node. Compare the scheme/host,
  // and bind IPC to the one owned top-level frame, never a same-origin iframe.
  return !!contents && !contents.isDestroyed() && event.sender === contents
    && event.senderFrame === contents.mainFrame && applicationUrl(event.senderFrame?.url);
}

module.exports = { APP_ORIGIN, APP_URL, applicationUrl, externalUrl, trustedFrame };
