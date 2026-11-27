process.env.JWT_SECRET = 'unit-test-secret';
delete process.env.SUPABASE_URL;

jest.mock('../lib/prisma', () => ({
  profile: { findUnique: jest.fn() },
  preference: {
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
}));

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('./helpers/inject');
const prisma = require('../lib/prisma');
const routes = require('../routes');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const adminToken = `Bearer ${jwt.sign(
  { aud: 'authenticated', sub: ADMIN_ID, role: 'authenticated' },
  process.env.JWT_SECRET,
  { algorithm: 'HS256' }
)}`;

const app = express();
app.use(express.json());
app.use('/', routes);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.profile.findUnique.mockResolvedValue({ role: 'admin' });
});

describe('Preferences API', () => {
  it('GET /preferences returns the preference list publicly', async () => {
    prisma.preference.findMany.mockResolvedValue([{ PreferenceID: 1, name: 'Healthy' }]);
    const res = await request(app).get('/preferences');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('Healthy');
  });

  it('POST /preferences creates a preference for admins and supports DELETE cleanup', async () => {
    prisma.preference.create.mockResolvedValue({ PreferenceID: 42, name: 'Spicy Test' });
    prisma.preference.delete.mockResolvedValue({ PreferenceID: 42 });

    const res = await request(app)
      .post('/preferences')
      .set('Authorization', adminToken)
      .send({ name: 'Spicy Test' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ PreferenceID: 42, name: 'Spicy Test' });

    const del = await request(app)
      .delete('/preferences/42')
      .set('Authorization', adminToken);
    expect(del.statusCode).toBe(200);
  });

  it('POST /preferences returns 409 when name already exists', async () => {
    prisma.preference.create.mockRejectedValue({ code: 'P2002' });
    const res = await request(app)
      .post('/preferences')
      .set('Authorization', adminToken)
      .send({ name: 'Healthy' });
    expect(res.statusCode).toBe(409);
  });
});
