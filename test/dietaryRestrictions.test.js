process.env.JWT_SECRET = 'unit-test-secret';
delete process.env.SUPABASE_URL;

jest.mock('../lib/prisma', () => ({
  profile: { findUnique: jest.fn() },
  dietaryRestriction: {
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

describe('Dietary Restrictions API', () => {
  it('GET /dietary-restrictions returns the restriction list publicly', async () => {
    prisma.dietaryRestriction.findMany.mockResolvedValue([{ DietaryRestrictionID: 1, name: 'Gluten Free' }]);
    const res = await request(app).get('/dietary-restrictions');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('Gluten Free');
  });

  it('POST /dietary-restrictions creates a restriction for admins and supports DELETE cleanup', async () => {
    prisma.dietaryRestriction.create.mockResolvedValue({ DietaryRestrictionID: 7, name: 'Nut Free Test' });
    prisma.dietaryRestriction.delete.mockResolvedValue({ DietaryRestrictionID: 7 });

    const res = await request(app)
      .post('/dietary-restrictions')
      .set('Authorization', adminToken)
      .send({ name: 'Nut Free Test' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ DietaryRestrictionID: 7, name: 'Nut Free Test' });

    const del = await request(app)
      .delete('/dietary-restrictions/7')
      .set('Authorization', adminToken);
    expect(del.statusCode).toBe(200);
  });

  it('POST /dietary-restrictions returns 409 when name already exists', async () => {
    prisma.dietaryRestriction.create.mockRejectedValue({ code: 'P2002' });
    const res = await request(app)
      .post('/dietary-restrictions')
      .set('Authorization', adminToken)
      .send({ name: 'Gluten Free' });
    expect(res.statusCode).toBe(409);
  });
});
