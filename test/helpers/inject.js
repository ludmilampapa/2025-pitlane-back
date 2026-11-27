// test/helpers/inject.js
// Minimal supertest-like client that talks to an Express app IN-PROCESS (no TCP port is opened),
// so authorization tests also run in sandboxed CI containers. Supports:
//   await request(app).post('/x').set('Authorization', 'Bearer ..').query({a:1}).send({b:2}).expect(201)
const http = require('http');
const { Duplex } = require('stream');

function dispatch(app, { method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const outChunks = [];
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, cb) {
        cb();
      },
    });
    socket.remoteAddress = '127.0.0.1';

    const req = new http.IncomingMessage(socket);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    req.method = method;
    req.url = url;
    req.headers = {
      host: 'localhost',
      ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
    };
    for (const [key, value] of Object.entries(headers)) req.headers[key.toLowerCase()] = value;
    // Without this Node treats the request as "aborted" once the body stream ends and destroys the socket
    req.complete = true;
    if (payload) req.push(payload);
    req.push(null);

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    const originalWrite = res.write;
    const originalEnd = res.end;
    res.write = function (chunk, encoding, cb) {
      if (chunk) outChunks.push(Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
      return originalWrite.apply(this, arguments);
    };
    res.end = function (chunk, encoding, cb) {
      if (chunk && typeof chunk !== 'function') {
        outChunks.push(Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
      }
      return originalEnd.apply(this, arguments);
    };
    res.on('finish', () => {
      const text = Buffer.concat(outChunks).toString('utf8');
      let json;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch (e) {
        json = undefined;
      }
      resolve({ status: res.statusCode, statusCode: res.statusCode, text, body: json, headers: res.getHeaders() });
    });
    res.on('error', reject);


    try {
      app(req, res, (err) => {
        res.statusCode = err ? 500 : 404;
        res.end(err ? String(err) : 'Not found');
      });
    } catch (err) {
      reject(err);
    }
  });
}

class Test {
  constructor(app, method, url) {
    this.app = app;
    this.opts = { method, url, headers: {}, body: undefined };
    this.expected = [];
    this.params = null;
  }
  set(key, value) {
    this.opts.headers[key] = value;
    return this;
  }
  query(params) {
    this.params = params;
    return this;
  }
  send(body) {
    this.opts.body = body;
    return this;
  }
  expect(status) {
    this.expected.push(status);
    return this;
  }
  then(resolve, reject) {
    const opts = { ...this.opts };
    if (this.params) {
      const qs = new URLSearchParams(this.params).toString();
      opts.url += (opts.url.includes('?') ? '&' : '?') + qs;
    }
    return dispatch(this.app, opts)
      .then((response) => {
        for (const status of this.expected) {
          if (response.status !== status) {
            throw new Error(
              `${opts.method} ${opts.url}: expected ${status} but got ${response.status} (${response.text})`
            );
          }
        }
        return response;
      })
      .then(resolve, reject);
  }
}

const request = (app) => ({
  get: (url) => new Test(app, 'GET', url),
  post: (url) => new Test(app, 'POST', url),
  put: (url) => new Test(app, 'PUT', url),
  patch: (url) => new Test(app, 'PATCH', url),
  delete: (url) => new Test(app, 'DELETE', url),
});

module.exports = request;
