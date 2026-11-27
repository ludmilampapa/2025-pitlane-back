process.env.JWT_SECRET = 'unit-test-secret';
delete process.env.SUPABASE_URL;

jest.mock('../lib/prisma', () => ({
  profile: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../controllers/profilesLib');

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('./helpers/inject');
const prisma = require('../lib/prisma');
const profilesLib = require('../controllers/profilesLib');
const routes = require('../routes');

const USER_ID = '00000000-0000-4000-8000-000000000001';
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

describe('Profile Preferences and Dietary Restrictions API', () => {
  it('returns 401 for requests without authorization', async () => {
    const res = await request(app).get(`/profile/${USER_ID}/full`);
    expect(res.statusCode).toBe(401);
  });

  it('POST /profile/:id/preferences validates array and updates preferences', async () => {
    const empty = await request(app)
      .post(`/profile/${USER_ID}/preferences`)
      .set('Authorization', userToken)
      .send({ preferences: [] });
    expect(empty.statusCode).toBe(400);

    profilesLib.addPreferencesToProfile.mockResolvedValue({ id: USER_ID, username: 'tester', role: 'user' });
    const ok = await request(app)
      .post(`/profile/${USER_ID}/preferences`)
      .set('Authorization', userToken)
      .send({ preferences: [1, 2] });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.id).toBe(USER_ID);
  });

  it('PUT /profile/:id/preferences-and-restrictions validates and updates both arrays', async () => {
    const bad = await request(app)
      .put(`/profile/${USER_ID}/preferences-and-restrictions`)
      .set('Authorization', userToken)
      .send({ preferences: 'not-an-array', dietaryRestrictions: [] });
    expect(bad.statusCode).toBe(400);

    prisma.profile.update.mockResolvedValue({
      id: USER_ID,
      username: 'tester',
      role: 'user',
      Preference: [{ PreferenceID: 1, name: 'Healthy' }],
      DietaryRestriction: [{ DietaryRestrictionID: 2, name: 'Gluten Free' }],
    });
    const ok = await request(app)
      .put(`/profile/${USER_ID}/preferences-and-restrictions`)
      .set('Authorization', userToken)
      .send({ preferences: [1], dietaryRestrictions: [2] });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.id).toBe(USER_ID);
  });

  it('GET /profile/:id/full returns profile or 404 when not found', async () => {
    profilesLib.getProfileById.mockResolvedValue(null);
    const missing = await request(app)
      .get(`/profile/${USER_ID}/full`)
      .set('Authorization', userToken);
    expect(missing.statusCode).toBe(404);

    profilesLib.getProfileById.mockResolvedValue({
      id: USER_ID,
      username: 'tester',
      role: 'user',
      Preference: [],
      DietaryRestriction: [],
    });
    const found = await request(app)
      .get(`/profile/${USER_ID}/full`)
      .set('Authorization', userToken);
    expect(found.statusCode).toBe(200);
    expect(found.body.username).toBe('tester');
  });
});
