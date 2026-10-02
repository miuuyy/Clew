const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_ORIGIN, applicationUrl } = require('./security.cjs');

// Production and the native Electron peer share this one tested HTTP transport.
// Electron net.fetch is reserved for local bundle files; there is no fallback.
const fetchBackend = (url, options) => globalThis.fetch(url, options);

function contentSecurityPolicy(apiBase) {
  const api = new URL(apiBase);
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || !api.port || api.username || api.password || api.pathname !== '/') {
    throw new Error('Invalid private backend origin.');
  }
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; `
    + `img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; `
    + `worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'`;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function createProtocolHandler({ frontendDir, apiBase, sessionToken, fetchFile, fetchBackend }) {
  const root = await fs.realpath(frontendDir);
  const csp = contentSecurityPolicy(apiBase);
  return async request => {
    if (!applicationUrl(request.url) || (request.initiatorOrigin && request.initiatorOrigin !== APP_ORIGIN)) {
      return new Response('Forbidden', { status: 403 });
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/v1/')) {
      if (request.initiatorOrigin !== APP_ORIGIN || request.headers.get('X-Clew-Session') !== sessionToken) return new Response('Forbidden', { status: 403 });
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      const headers = new Headers({ 'X-Clew-Session': sessionToken, Origin: APP_ORIGIN });
      for (const name of ['content-type', 'accept']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      // Construct the destination from the owned host, never from a renderer URL.
      // Preserve streaming request/response bodies for chat without buffering them.
      const response = await fetchBackend(`${apiBase}${url.pathname}${url.search}`, {
        method: request.method, headers, redirect: 'error', signal: request.signal,
        ...(!['GET', 'HEAD'].includes(request.method) ? { body: request.body, duplex: 'half' } : {})
      });
      return new Response(response.body, { status: response.status, headers: response.headers });
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); }
    catch { return new Response('Invalid path', { status: 400 }); }
    if (pathname.includes('\\') || pathname.includes('\0')) return new Response('Invalid path', { status: 400 });
    const candidate = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!inside(root, candidate)) return new Response('Forbidden', { status: 403 });
    let file;
    try {
      file = await fs.realpath(candidate);
      if (!inside(root, file)) return new Response('Forbidden', { status: 403 });
      if (!(await fs.stat(file)).isFile()) return new Response('Not found', { status: 404 });
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return new Response('Not found', { status: 404 });
      throw error;
    }
    const response = await fetchFile(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', csp);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Cache-Control', 'no-store');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
  };
}

module.exports = { contentSecurityPolicy, createProtocolHandler, fetchBackend };
