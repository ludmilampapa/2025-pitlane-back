process.env.JWT_SECRET = 'unit-test-secret';
delete process.env.SUPABASE_URL;

jest.mock('../lib/prisma', () => ({
  profile: { findUnique: jest.fn() },
  group: { findFirst: jest.fn() },
}));
jest.mock('../controllers/consumptionsLib');

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('./helpers/inject');
const prisma = require('../lib/prisma');
const consumptionsLib = require('../controllers/consumptionsLib');
const routes = require('../routes');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const userToken = `Bearer ${jwt.sign(
  { aud: 'authenticated', sub: USER_ID, role: 'authenticated' },
  process.env.JWT_SECRET,
  { algorithm: 'HS256' }
)}`;

const app = express();
app.use(express.json());
app.use('/', routes);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.profile.findUnique.mockResolvedValue({ role: 'user' });
});

describe('Consumptions API', () => {
  describe('GET /consumptions/groups/:groupId/most-consumed', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/consumptions/groups/99999/most-consumed');
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 when group does not exist for authenticated user', async () => {
      prisma.group.findFirst.mockResolvedValue(null);
      const res = await request(app)
        .get('/consumptions/groups/99999/most-consumed')
        .set('Authorization', userToken);
      expect(res.statusCode).toBe(404);
    });

    it('returns proper structure for a valid group member', async () => {
      prisma.group.findFirst.mockResolvedValue({ createdBy: USER_ID, members: [{ role: 'admin' }] });
      consumptionsLib.getGroupMostConsumedMeals.mockResolvedValue({
        groupId: 1,
        mostConsumedMeals: [{ mealId: 10, name: 'Salad', count: 3 }],
      });
      const res = await request(app)
        .get('/consumptions/groups/1/most-consumed?limit=3')
        .set('Authorization', userToken);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('groupId', 1);
      expect(Array.isArray(res.body.mostConsumedMeals)).toBe(true);
    });
  });

  describe('GET /consumptions/groups/:groupId/filtered-meals', () => {
    it('returns 404 for non-existent group', async () => {
      prisma.group.findFirst.mockResolvedValue(null);
      const res = await request(app)
        .get('/consumptions/groups/99999/filtered-meals')
        .set('Authorization', userToken);
      expect(res.statusCode).toBe(404);
    });
  });
});
