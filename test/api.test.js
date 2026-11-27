process.env.JWT_SECRET = 'unit-test-secret';
delete process.env.SUPABASE_URL;

const express = require('express');
const request = require('./helpers/inject');
const routes = require('../routes');

const app = express();
app.use(express.json());
app.use('/', routes);

describe('Basic API health check', () => {
  it('GET / enforces JWT auth by default', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(401);
  });
});
