// Authorization regression tests: no database or network needed (Prisma + controllers are mocked).
process.env.JWT_SECRET = 'unit-test-secret';
delete process.env.SUPABASE_URL;

jest.mock('../lib/prisma', () => ({
  profile: { findUnique: jest.fn() },
  group: { findFirst: jest.fn() },
  votingSession: { findUnique: jest.fn() },
  food: { findUnique: jest.fn() },
  meal: { findUnique: jest.fn() },
  consumption: { findFirst: jest.fn() },
  preference: { findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
  dietaryRestriction: { findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
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
const consumptionsLib = require('../controllers/consumptionsLib');
const groupsLib = require('../controllers/groupsLib');
const votingLib = require('../controllers/votingLib');
const profilesLib = require('../controllers/profilesLib');
const mealsLib = require('../controllers/mealsLib');
const groupChallengesLib = require('../controllers/groupChallengesLib');
const fullApp = require('../index');

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const app = express();
app.use(express.json());
app.use('/', routes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message })); // eslint-disable-line no-unused-vars

const sign = (claims, opts = {}) =>
  jwt.sign({ aud: 'authenticated', ...claims }, process.env.JWT_SECRET, { algorithm: 'HS256', ...opts });
const userToken = (sub = ME) => `Bearer ${sign({ sub, role: 'authenticated' })}`;

function asRole(role) {
  prisma.profile.findUnique.mockResolvedValue({ role });
}
function groupWith({ createdBy = OTHER, memberRole = null } = {}) {
  prisma.group.findFirst.mockResolvedValue({
    createdBy,
    members: memberRole ? [{ role: memberRole }] : [],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  asRole('user');
  prisma.group.findFirst.mockResolvedValue(null);
});

describe('authentication', () => {
  test('rejects requests without a token', async () => {
    await request(app).get('/meals/all').expect(401);
  });

  test('rejects the public anon API key (signed with the same secret, no sub)', async () => {
    const anon = sign({ role: 'anon', iss: 'supabase' });
    await request(app).get('/meals/all').set('Authorization', `Bearer ${anon}`).expect(403);
  });

  test('rejects tokens signed with another secret or algorithm none', async () => {
    const forged = jwt.sign({ sub: ME, role: 'authenticated', aud: 'authenticated' }, 'other-secret');
    await request(app).get('/meals/all').set('Authorization', `Bearer ${forged}`).expect(403);
  });

  test('rejects tokens with the wrong audience', async () => {
    const t = sign({ sub: ME, role: 'authenticated', aud: 'somebody-else' });
    await request(app).get('/meals/all').set('Authorization', `Bearer ${t}`).expect(403);
  });
});

describe('identity binding (IDOR)', () => {
  test('consumption cannot be created for another profile', async () => {
    await request(app)
      .post('/consumptions/individual')
      .set('Authorization', userToken())
      .send({ name: 'Lunch', profileId: OTHER, meals: [{ mealId: 1 }] })
      .expect(403);
    expect(consumptionsLib.createIndividualConsumption).not.toHaveBeenCalled();
  });

  test('profileId is always the JWT subject, even when omitted', async () => {
    consumptionsLib.createIndividualConsumption.mockResolvedValue({ ok: true });
    await request(app)
      .post('/consumptions/individual')
      .set('Authorization', userToken())
      .send({ name: 'Lunch', meals: [{ mealId: 1 }] })
      .expect(201);
    expect(consumptionsLib.createIndividualConsumption).toHaveBeenCalledWith(expect.anything(), ME);
  });

  test('group deletion uses the token identity, not the body userId', async () => {
    await request(app).delete('/groups/3').set('Authorization', userToken()).send({ userId: OTHER }).expect(403);
    await request(app).delete('/groups/3').set('Authorization', userToken()).send({}).expect(200);
    expect(groupsLib.deleteGroup).toHaveBeenCalledWith('3', ME);
  });

  test('cannot vote on behalf of someone else', async () => {
    groupWith({ createdBy: OTHER, memberRole: 'member' });
    prisma.votingSession.findUnique.mockResolvedValue({ groupId: 1 });
    await request(app)
      .post('/voting/sessions/9/vote')
      .set('Authorization', userToken())
      .send({ mealProposalId: 1, voterId: OTHER })
      .expect(403);
    expect(votingLib.castVote).not.toHaveBeenCalled();
  });

  test('consumption list without filters is forced to the caller', async () => {
    consumptionsLib.getConsumptions.mockResolvedValue([]);
    await request(app)
      .get('/consumptions')
      .query({ profileId: OTHER })
      .set('Authorization', userToken())
      .expect(200);
    expect(consumptionsLib.getConsumptions).toHaveBeenCalledWith({ profileId: ME });
  });

  test("another user's individual consumptions are not readable", async () => {
    await request(app).get(`/consumptions/user/${OTHER}`).set('Authorization', userToken()).expect(403);
    consumptionsLib.getConsumptions.mockResolvedValue([]);
    await request(app).get(`/consumptions/user/${ME}`).set('Authorization', userToken()).expect(200);
  });
});

describe('profile', () => {
  test('a user cannot delete or edit another profile', async () => {
    await request(app).delete(`/profile/${OTHER}`).set('Authorization', userToken()).expect(403);
    await request(app)
      .patch(`/profile/${OTHER}/username`)
      .set('Authorization', userToken())
      .send({ username: 'hacked' })
      .expect(403);
    expect(profilesLib.deleteProfile).not.toHaveBeenCalled();
  });

  test('role escalation is blocked for regular users, allowed for admins', async () => {
    await request(app)
      .patch(`/profile/${ME}/role`)
      .set('Authorization', userToken())
      .send({ role: 'admin' })
      .expect(403);

    asRole('admin');
    profilesLib.updateProfileRole.mockResolvedValue({ id: OTHER, username: 'x', role: 'admin' });
    await request(app)
      .patch(`/profile/${OTHER}/role`)
      .set('Authorization', userToken())
      .send({ role: 'admin' })
      .expect(200);
  });

  test('role must be a valid enum value and calorie goal is range checked', async () => {
    asRole('admin');
    await request(app).patch(`/profile/${ME}/role`).set('Authorization', userToken()).send({ role: 'root' }).expect(400);
    await request(app).put(`/profile/${ME}/calorie-goal`).set('Authorization', userToken()).send({ calorieGoal: 99999 }).expect(400);
  });

  test('full user directory is admin only', async () => {
    await request(app).get('/profile').set('Authorization', userToken()).expect(403);
  });

  test('POST /profile id must match the token', async () => {
    await request(app).post('/profile').set('Authorization', userToken()).send({ id: OTHER, username: 'x' }).expect(403);
  });
});

describe('catalogs and admin tools', () => {
  test('preferences / dietary restrictions: only admins can write', async () => {
    await request(app).post('/preferences').set('Authorization', userToken()).send({ name: 'Vegan' }).expect(403);
    await request(app).delete('/preferences/1').set('Authorization', userToken()).expect(403);
    await request(app).post('/dietary-restrictions').set('Authorization', userToken()).send({ name: 'Gluten' }).expect(403);

    asRole('admin');
    prisma.preference.create.mockResolvedValue({ PreferenceID: 1, name: 'Vegan' });
    await request(app).post('/preferences').set('Authorization', userToken()).send({ name: 'Vegan' }).expect(201);
  });

  test('catalog GET stays public', async () => {
    prisma.preference.findMany.mockResolvedValue([]);
    await request(app).get('/preferences').expect(200);
  });

  test('badge awarding is admin only', async () => {
    await request(app).post('/badges/award').set('Authorization', userToken()).send({ profileId: ME, badgeId: 1 }).expect(403);
    await request(app).post('/badges/check').set('Authorization', userToken()).send({ profileId: ME, action: 'x' }).expect(403);
    await request(app).post(`/badges/award-retroactive/${OTHER}`).set('Authorization', userToken()).expect(403);
  });
});

describe('resource ownership', () => {
  test('foods and meals can only be changed by their creator or an admin', async () => {
    prisma.food.findUnique.mockResolvedValue({ profileId: OTHER });
    prisma.meal.findUnique.mockResolvedValue({ profileId: OTHER });
    await request(app).put('/foods/5').set('Authorization', userToken()).send({ name: 'x' }).expect(403);
    await request(app).delete('/foods/5').set('Authorization', userToken()).expect(403);
    await request(app).put('/meals/5').set('Authorization', userToken()).send({ name: 'x' }).expect(403);
    await request(app).delete('/meals/5').set('Authorization', userToken()).expect(403);
    expect(mealsLib.deleteMeal).not.toHaveBeenCalled();

    prisma.meal.findUnique.mockResolvedValue({ profileId: ME });
    mealsLib.deleteMeal.mockResolvedValue(true);
    await request(app).delete('/meals/5').set('Authorization', userToken()).expect(204);

    asRole('admin');
    prisma.meal.findUnique.mockResolvedValue({ profileId: OTHER });
    await request(app).delete('/meals/5').set('Authorization', userToken()).expect(204);
  });
});

describe('group scoped data', () => {
  test('non-members cannot read group dietary info, members can', async () => {
    await request(app).get('/groups/1/dietary-info').set('Authorization', userToken()).expect(404); // no such group

    groupWith({ createdBy: OTHER, memberRole: null });
    await request(app).get('/groups/1/dietary-info').set('Authorization', userToken()).expect(403);

    groupWith({ createdBy: OTHER, memberRole: 'member' });
    groupsLib.getGroupDietaryInfo.mockResolvedValue({});
    await request(app).get('/groups/1/dietary-info').set('Authorization', userToken()).expect(200);
  });

  test('adding members directly requires group admin', async () => {
    groupWith({ createdBy: OTHER, memberRole: 'member' });
    await request(app).post('/groups/1/members').set('Authorization', userToken()).send({ profileId: ME, role: 'admin' }).expect(403);
    expect(groupsLib.addGroupMember).not.toHaveBeenCalled();
  });

  test('voting data is limited to members of the session group', async () => {
    prisma.votingSession.findUnique.mockResolvedValue({ groupId: 1 });
    groupWith({ createdBy: OTHER, memberRole: null });
    await request(app).get('/voting/sessions/9').set('Authorization', userToken()).expect(403);
    await request(app).get('/voting/history/sessions/9').set('Authorization', userToken()).expect(403);
    await request(app).get('/voting/groups/1/active').set('Authorization', userToken()).expect(403);
  });

  test('numeric params are strictly validated (no parseInt("1abc") bypass)', async () => {
    await request(app).get('/voting/sessions/1abc').set('Authorization', userToken()).expect(400);
    await request(app).delete('/groups/1abc').set('Authorization', userToken()).send({}).expect(400);
  });

  test('group challenges list passes authenticated actorId to membership check', async () => {
    groupChallengesLib.listChallenges.mockResolvedValue([]);
    await request(app).get('/groups/7/challenges').set('Authorization', userToken()).expect(200);
    expect(groupChallengesLib.listChallenges).toHaveBeenCalledWith('7', ME);
  });

  test('GET /groups always scopes to the caller and never leaks strangers groups, even for site admins', async () => {
    asRole('admin');
    groupsLib.getUserGroups.mockResolvedValue([]);
    await request(app).get('/groups').query({ userId: OTHER }).set('Authorization', userToken()).expect(200);
    expect(groupsLib.getUserGroups).toHaveBeenCalledWith(ME);
    expect(groupsLib.getAllGroups).not.toHaveBeenCalled();
  });

  test('GET /groups/:id blocks non-members even when the caller has Profile.role === admin', async () => {
    asRole('admin');
    groupWith({ createdBy: OTHER, memberRole: null });
    await request(app).get('/groups/42').set('Authorization', userToken()).expect(403);
    expect(groupsLib.getGroupById).not.toHaveBeenCalled();

    groupWith({ createdBy: OTHER, memberRole: 'member' });
    groupsLib.getGroupById.mockResolvedValue({ GroupID: 42 });
    await request(app).get('/groups/42').set('Authorization', userToken()).expect(200);
  });

  test('accepting an invitation binds userId strictly to the authenticated user', async () => {
    await request(app)
      .put('/groups/invitations/10/respond')
      .set('Authorization', userToken())
      .send({ userId: OTHER, response: 'accept' })
      .expect(403);
    expect(groupsLib.respondToInvitation).not.toHaveBeenCalled();
  });
});

describe('HTTP hardening (index.js)', () => {
  test('sets CSP and security headers and rejects spoofed Vercel preview origins', async () => {
    const okRes = await request(fullApp).get('/').set('Origin', 'https://quecomemos-front.vercel.app').expect(200);
    expect(okRes.headers['content-security-policy']).toContain("default-src 'none'");
    expect(okRes.headers['x-frame-options']).toBe('DENY');

    await request(fullApp)
      .get('/')
      .set('Origin', 'https://quecomemos-front-attacker.vercel.app')
      .expect(403);
  });
});
