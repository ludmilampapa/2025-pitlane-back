process.env.JWT_SECRET = 'unit-test-secret';
delete process.env.SUPABASE_URL;

jest.mock('../lib/prisma', () => ({
  profile: { findUnique: jest.fn() },
  food: { findUnique: jest.fn() },
}));
jest.mock('../controllers/foodsLib');

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('./helpers/inject');
const prisma = require('../lib/prisma');
const foodsLib = require('../controllers/foodsLib');
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

describe('Foods API', () => {
  it('GET /foods requires auth and returns an array for authenticated users', async () => {
    const unauth = await request(app).get('/foods');
    expect(unauth.statusCode).toBe(401);

    foodsLib.getAllFoods.mockResolvedValue([{ FoodID: 1, name: 'Apple', kCal: 95 }]);
    const res = await request(app).get('/foods').set('Authorization', userToken);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /foods/by-preference-and-restriction returns an array', async () => {
    foodsLib.getFoodsByPreferenceAndRestriction.mockResolvedValue([{ FoodID: 2, name: 'Quinoa', kCal: 120 }]);
    const res = await request(app)
      .post('/foods/by-preference-and-restriction')
      .set('Authorization', userToken)
      .send({ preferenceId: 1, restrictionId: 1 });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /foods/recommended/:profileId returns array for self', async () => {
    foodsLib.getRecommendedFoodsForProfile.mockResolvedValue([{ FoodID: 3, name: 'Avocado', kCal: 160 }]);
    const res = await request(app)
      .get(`/foods/recommended/${USER_ID}`)
      .set('Authorization', userToken);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
