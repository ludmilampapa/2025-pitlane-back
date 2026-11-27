jest.mock('../lib/prisma', () => ({
  profile: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  consumption: {
    findMany: jest.fn(),
  },
}));

const prisma = require('../lib/prisma');
const { getCalorieProgress, updateCalorieGoal } = require('../controllers/profilesLib');

const testProfileId = '00000000-0000-0000-0000-000000000002';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Calorie Progress Controller', () => {
  it('returns 0 consumed calories and default goal when no consumptions exist', async () => {
    prisma.profile.findUnique.mockResolvedValue({ id: testProfileId, calorie_goal: 2000 });
    prisma.consumption.findMany.mockResolvedValue([]);

    const progress = await getCalorieProgress(testProfileId, '2026-11-25');
    expect(progress).toEqual({ consumed: 0, goal: 2000, date: '2026-11-25' });

    const callWhere = prisma.consumption.findMany.mock.calls[0][0].where;
    expect(callWhere.consumedAt.gte.toISOString()).toBe('2026-11-25T03:00:00.000Z');
    expect(callWhere.consumedAt.lte.toISOString()).toBe('2026-11-26T02:59:59.999Z');
    expect(callWhere.type).toBe('individual');
  });

  it('sums whole meals and partial foodPortions accurately', async () => {
    prisma.profile.findUnique.mockResolvedValue({ id: testProfileId, calorie_goal: 2500 });
    prisma.consumption.findMany.mockResolvedValue([
      {
        totalKcal: 300,
        consumptionMeals: [
          {
            quantity: 1,
            meal: {
              mealFoods: [
                { quantity: 1, food: { kCal: 100 } },
                { quantity: 1, food: { kCal: 200 } },
              ],
            },
            mealPortion: null,
          },
        ],
      },
      {
        totalKcal: 150,
        consumptionMeals: [
          {
            quantity: 1,
            meal: {
              mealFoods: [{ quantity: 1, food: { kCal: 300 } }],
            },
            mealPortion: {
              portionFraction: 0.5,
              foodPortions: [{ quantityConsumed: 0.5, food: { kCal: 300 } }],
            },
          },
        ],
      },
    ]);

    const progress = await getCalorieProgress(testProfileId, '2026-11-25');
    expect(progress.consumed).toBe(450);
    expect(progress.goal).toBe(2500);
  });

  it('updates calorie goal via prisma.profile.update', async () => {
    prisma.profile.update.mockResolvedValue({ id: testProfileId, calorie_goal: 2200 });
    const updated = await updateCalorieGoal(testProfileId, 2200);
    expect(updated.calorie_goal).toBe(2200);
  });
});
