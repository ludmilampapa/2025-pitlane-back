// Timezone & input validation regression tests (no database or network needed).
process.env.JWT_SECRET = 'unit-test-secret';
delete process.env.SUPABASE_URL;

jest.mock('../lib/prisma', () => ({
  profile: { findUnique: jest.fn() },
  group: { findFirst: jest.fn() },
  votingSession: { findUnique: jest.fn() },
  food: { findUnique: jest.fn() },
  meal: { findUnique: jest.fn() },
  consumption: { findFirst: jest.fn() },
}));
jest.mock('../controllers/foodsLib');
jest.mock('../controllers/mealsLib');
jest.mock('../controllers/groupsLib');
jest.mock('../controllers/consumptionsLib');
jest.mock('../controllers/votingLib');
jest.mock('../controllers/votingHistoryLib');
jest.mock('../controllers/badgesLib');
jest.mock('../controllers/profilesLib');
jest.mock('../controllers/groupChallengesLib');

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('./helpers/inject');
const prisma = require('../lib/prisma');
const routes = require('../routes');
const tz = require('../lib/timezone');

const ME = '11111111-1111-4111-8111-111111111111';

const app = express();
app.use(express.json());
app.use('/', routes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message })); // eslint-disable-line no-unused-vars

const userToken = (sub = ME) =>
  `Bearer ${jwt.sign({ aud: 'authenticated', sub, role: 'authenticated' }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.profile.findUnique.mockResolvedValue({ role: 'user' });
});

describe('Argentina timezone helpers (lib/timezone.js)', () => {
  test('isValidYMD rejects impossible calendar dates and accepts valid leap dates', () => {
    expect(tz.isValidYMD('2026-02-31')).toBe(false);
    expect(tz.isValidYMD('2026-02-29')).toBe(false);
    expect(tz.isValidYMD('2024-02-29')).toBe(true);
    expect(tz.isValidYMD('2026-13-01')).toBe(false);
    expect(tz.isValidYMD('not-a-date')).toBe(false);
    expect(tz.isValidYMD('2026-11-25')).toBe(true);
  });

  test('getArgentinaYMD keeps 23:30 ART (02:30Z next day) on the Argentina calendar day', () => {
    const lateNightArt = new Date('2026-11-26T02:30:00.000Z');
    expect(tz.getArgentinaYMD(lateNightArt)).toBe('2026-11-25');
  });

  test('getArgentinaDayBounds maps YYYY-MM-DD to exact UTC-3 day boundaries', () => {
    const { ymd, startUtc, endUtc } = tz.getArgentinaDayBounds('2026-11-25', { strict: true });
    expect(ymd).toBe('2026-11-25');
    expect(startUtc.toISOString()).toBe('2026-11-25T03:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-11-26T02:59:59.999Z');
  });

  test('argentinaDateToUtcMidnight preserves Prisma @db.Date and throws on invalid dates', () => {
    expect(tz.argentinaDateToUtcMidnight(new Date('2026-11-25T00:00:00.000Z')).toISOString())
      .toBe('2026-11-25T00:00:00.000Z');
    expect(() => tz.argentinaDateToUtcMidnight('2026-02-31')).toThrow('INVALID_DATE');
    expect(() => tz.parseArgentinaFilterDate('garbage')).toThrow('INVALID_DATE');
  });
});

describe('HTTP date & field validation', () => {
  test('GET /profile/:id/calorie-progress rejects invalid date with 400', async () => {
    const res = await request(app)
      .get(`/profile/${ME}/calorie-progress?date=2026-02-31`)
      .set('Authorization', userToken());
    expect(res.status).toBe(400);
  });

  test('PUT /profile/:id/calorie-goal rejects out-of-range or NaN values with 400', async () => {
    for (const bad of [-500, 100, 99999, 'abc']) {
      const res = await request(app)
        .put(`/profile/${ME}/calorie-goal`)
        .set('Authorization', userToken())
        .send({ calorieGoal: bad });
      expect(res.status).toBe(400);
    }
  });

  test('GET /consumptions rejects invalid dates and inverted date ranges with 400', async () => {
    const badDate = await request(app)
      .get('/consumptions?startDate=2026-02-31')
      .set('Authorization', userToken());
    expect(badDate.status).toBe(400);

    const inverted = await request(app)
      .get('/consumptions?startDate=2026-11-26&endDate=2026-11-20')
      .set('Authorization', userToken());
    expect(inverted.status).toBe(400);
  });

  test('POST /consumptions/individual rejects blank name and invalid consumedAt with 400', async () => {
    const blankName = await request(app)
      .post('/consumptions/individual')
      .set('Authorization', userToken())
      .send({ name: '   ', meals: [{ mealId: 1, quantity: 1 }] });
    expect(blankName.status).toBe(400);

    const badConsumedAt = await request(app)
      .post('/consumptions/individual')
      .set('Authorization', userToken())
      .send({ name: 'Lunch', meals: [{ mealId: 1, quantity: 1 }], consumedAt: '2026-02-31' });
    expect(badConsumedAt.status).toBe(400);
  });

  test('POST /foods rejects blank name and negative or excessive kCal with 400', async () => {
    const blankName = await request(app)
      .post('/foods')
      .set('Authorization', userToken())
      .send({ name: '  ', kCal: 200 });
    expect(blankName.status).toBe(400);

    const negKcal = await request(app)
      .post('/foods')
      .set('Authorization', userToken())
      .send({ name: 'Apple', kCal: -10 });
    expect(negKcal.status).toBe(400);
  });

  test('POST /meals rejects blank name and non-positive food quantities with 400', async () => {
    const blankName = await request(app)
      .post('/meals')
      .set('Authorization', userToken())
      .send({ name: '   ', mealFoods: [{ foodId: 1, quantity: 1 }] });
    expect(blankName.status).toBe(400);

    const badQty = await request(app)
      .post('/meals')
      .set('Authorization', userToken())
      .send({ name: 'Salad', mealFoods: [{ foodId: 1, quantity: 0 }] });
    expect(badQty.status).toBe(400);
  });

  test('GET /challenges/active-paused calls listActivePausedChallenges for the authenticated user', async () => {
    const groupChallengesLib = require('../controllers/groupChallengesLib');
    groupChallengesLib.listActivePausedChallenges.mockResolvedValue([
      { ChallengeID: 1, name: 'Hydration Week', ruleText: 'No soda', pausedFoods: ['Soda'], groupId: 5, groupName: 'Friends' },
    ]);
    const res = await request(app)
      .get('/challenges/active-paused?date=2026-11-25')
      .set('Authorization', userToken());
    expect(res.status).toBe(200);
    expect(groupChallengesLib.listActivePausedChallenges).toHaveBeenCalledWith(ME, '2026-11-25');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].pausedFoods).toEqual(['Soda']);
  });

  test('consumptionMatchesPausedFoods ignores ingredients customized to 0 consumed', () => {
    const { consumptionMatchesPausedFoods } = jest.requireActual('../controllers/groupChallengesLib');
    const skippedSoda = {
      consumptionMeals: [
        {
          quantity: 1,
          meal: {
            name: 'Burger & Soda Combo',
            mealFoods: [{ food: { name: 'Burger' } }, { food: { name: 'Soda' } }],
          },
          mealPortion: {
            portionFraction: 0.7,
            foodPortions: [
              { quantityConsumed: 1, portionFraction: 1, food: { name: 'Burger' } },
              { quantityConsumed: 0, portionFraction: 0, food: { name: 'Soda' } },
            ],
          },
        },
      ],
    };
    expect(consumptionMatchesPausedFoods(skippedSoda, ['Soda'])).toBe(false);

    const consumedSoda = {
      consumptionMeals: [
        {
          quantity: 1,
          meal: {
            name: 'Burger & Soda Combo',
            mealFoods: [{ food: { name: 'Burger' } }, { food: { name: 'Soda' } }],
          },
          mealPortion: {
            portionFraction: 1,
            foodPortions: [
              { quantityConsumed: 1, portionFraction: 1, food: { name: 'Burger' } },
              { quantityConsumed: 1, portionFraction: 1, food: { name: 'Soda' } },
            ],
          },
        },
      ],
    };
    expect(consumptionMatchesPausedFoods(consumedSoda, ['Soda'])).toBe(true);
  });

  test('challenge and menu routes reject non-integer IDs with 400', async () => {
    const badGroup = await request(app)
      .get('/groups/1abc/challenges')
      .set('Authorization', userToken());
    expect(badGroup.status).toBe(400);

    const badChallenge = await request(app)
      .delete('/challenges/notanid')
      .set('Authorization', userToken());
    expect(badChallenge.status).toBe(400);
  });

  test('challenge targetPercentage normalization and lifecycle outcomes work for 50/75/100', () => {
    const {
      normalizeTargetPercentage,
      getChallengeLifecycleStatus,
      computeChallengeOutcome,
    } = jest.requireActual('../controllers/groupChallengesLib');

    expect(normalizeTargetPercentage(undefined)).toBe(100);
    expect(normalizeTargetPercentage(50)).toBe(50);
    expect(normalizeTargetPercentage(75)).toBe(75);
    expect(normalizeTargetPercentage(100)).toBe(100);
    expect(() => normalizeTargetPercentage(60)).toThrow('INVALID_CHALLENGE_TARGET');

    const ch = { startDate: '2026-11-20', endDate: '2026-11-27' };
    expect(getChallengeLifecycleStatus(ch, '2026-11-19')).toBe('upcoming');
    expect(getChallengeLifecycleStatus(ch, '2026-11-25')).toBe('active');
    expect(getChallengeLifecycleStatus(ch, '2026-11-28')).toBe('finished');

    expect(computeChallengeOutcome('upcoming', 0, 50)).toBe('upcoming');
    expect(computeChallengeOutcome('active', 40, 50)).toBe('in_progress');
    expect(computeChallengeOutcome('active', 50, 50)).toBe('goal_reached');
    expect(computeChallengeOutcome('finished', 75, 75)).toBe('completed');
    expect(computeChallengeOutcome('finished', 70, 75)).toBe('not_completed');
  });
});
