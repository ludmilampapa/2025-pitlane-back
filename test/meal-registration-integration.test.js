process.env.JWT_SECRET = 'unit-test-secret';
delete process.env.SUPABASE_URL;

jest.mock('../lib/prisma', () => ({
  profile: { findUnique: jest.fn() },
}));
jest.mock('../controllers/consumptionsLib');
jest.mock('../controllers/profilesLib');

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('./helpers/inject');
const prisma = require('../lib/prisma');
const consumptionsLib = require('../controllers/consumptionsLib');
const profilesLib = require('../controllers/profilesLib');
const routes = require('../routes');

const USER_ID = '00000000-0000-4000-8000-000000000003';
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

describe('Meal Registration and Calorie Progress Flow', () => {
  it('registers an individual meal and returns updated calorie progress', async () => {
    consumptionsLib.createIndividualConsumption.mockResolvedValue({
      ConsumptionID: 101,
      name: 'Lunch',
      profileId: USER_ID,
      totalKcal: 500,
    });
    profilesLib.getCalorieProgress.mockResolvedValue({
      consumed: 500,
      goal: 2000,
      date: '2026-11-25',
    });

    const createRes = await request(app)
      .post('/consumptions/individual')
      .set('Authorization', userToken)
      .send({
        name: 'Lunch',
        meals: [{ mealId: 10, quantity: 1 }],
        consumedAt: '2026-11-25T15:00:00.000Z',
      });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body.totalKcal).toBe(500);

    const progressRes = await request(app)
      .get(`/profile/${USER_ID}/calorie-progress?date=2026-11-25`)
      .set('Authorization', userToken);
    expect(progressRes.statusCode).toBe(200);
    expect(progressRes.body).toEqual({ consumed: 500, goal: 2000, date: '2026-11-25' });
  });
});
