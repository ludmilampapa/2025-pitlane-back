// routes/guards.js
// Central authorization policy. Each router below is mounted in routes/index.js BEFORE the
// feature router it protects, so a request must pass these checks before reaching the handler.
// Rules of thumb:
//   * Identity fields in the body (profileId, userId, requesterId, ...) are forced to req.user.sub.
//   * Per-profile resources require "self" (or a site admin).
//   * Group data requires membership; group administration requires group-admin.
//   * Shared catalogs (foods, meals) can only be modified by their creator or a site admin.
const express = require('express');
const {
  actorId,
  bindBody,
  requireSelfParam,
  requireAdmin,
  requireUuidParam,
  requireIntParam,
  requireGroupMember,
  requireSessionMember,
  requireResourceOwner,
  clampQuery,
  isAdmin,
  overrideQuery,
  getGroupAccess,
  INT_RE,
} = require('../middleware/authz');
const prisma = require('../lib/prisma');
const { validateBody, str, int, oneOf, intArray, array } = require('../middleware/validate');

/** Reject dangerous URI schemes (javascript:, vbscript:, data:text/html) in URL fields. */
function rejectUnsafeUrl(field) {
  return (req, res, next) => {
    const val = req.body && req.body[field];
    if (val === undefined || val === null || val === '') return next();
    if (typeof val !== 'string') {
      return res.status(400).json({ error: `${field} must be a string` });
    }
    const trimmed = val.trim();
    const isSafe =
      trimmed.startsWith('https://') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('/') ||
      trimmed.startsWith('data:image/svg+xml') ||
      trimmed.startsWith('data:image/png') ||
      trimmed.startsWith('data:image/jpeg') ||
      trimmed.startsWith('data:image/webp');
    if (!isSafe) {
      return res.status(400).json({ error: `${field} contains an unsupported or unsafe URL scheme` });
    }
    return next();
  };
}

// ---------------------------------------------------------------- groups
const groups = express.Router();
const groupBody = validateBody({
  name: str({ min: 1, max: 100 }),
  description: str({ max: 500 }),
});

groups.get('/', (req, res, next) => {
  overrideQuery(req, { userId: actorId(req) });
  next();
});
groups.get('/:id', requireGroupMember('id'));
groups.get('/:id/dietary-info', requireGroupMember('id'));
groups.post('/', bindBody('createdBy'), validateBody({ name: str({ min: 1, max: 100, required: true }), description: str({ max: 500 }) }));
groups.put('/:id', requireIntParam('id'), bindBody('userId'), groupBody);
groups.delete('/:id', requireIntParam('id'), bindBody('userId'));
// Deprecated endpoint: adding someone without their consent is only allowed for group admins.
groups.post('/:id/members', requireGroupMember('id', { adminOnly: true }));
groups.post('/:id/invite', requireIntParam('id'), bindBody('invitedById'));
groups.delete('/:id/members/:profileId', requireIntParam('id'), requireUuidParam('profileId'), bindBody('requesterId'));
groups.get('/:id/invitations', requireIntParam('id'), (req, res, next) => {
  overrideQuery(req, { requesterId: actorId(req) });
  next();
});
groups.delete('/invitations/:invitationId', requireIntParam('invitationId'), bindBody('requesterId'));
groups.get('/invitations/:userId', requireSelfParam('userId', { allowAdmin: false }));
groups.put('/invitations/:invitationId/respond', requireIntParam('invitationId'), bindBody('userId'));
groups.get('/dashboard/:userId', requireSelfParam('userId', { allowAdmin: false }), clampQuery('limit', { min: 1, max: 20, fallback: 5 }));
groups.get('/search/users', (req, res, next) => {
  const { query, excludeIds } = req.query;
  if (query !== undefined && (typeof query !== 'string' || query.length > 50)) {
    return res.status(400).json({ error: 'Query too long' });
  }
  if (excludeIds !== undefined && (typeof excludeIds !== 'string' || excludeIds.length > 2000)) {
    return res.status(400).json({ error: 'excludeIds too long' });
  }
  return next();
});

// ---------------------------------------------------------------- consumptions
const consumptions = express.Router();

// Lists / stats: either scoped to a group the user belongs to, or forced to the user's own data.
const scopeConsumptionQuery = async (req, res, next) => {
  const { groupId } = req.query;
  if (groupId !== undefined) {
    return requireGroupMember('groupId', { source: 'query' })(req, res, next);
  }
  overrideQuery(req, { profileId: actorId(req) });
  return next();
};

consumptions.get('/', scopeConsumptionQuery);
consumptions.get('/stats', scopeConsumptionQuery);
consumptions.get('/user/:profileId', requireSelfParam('profileId'));
consumptions.get('/groups/:groupId/filtered-meals', requireGroupMember('groupId'));
consumptions.get(
  '/groups/:groupId/most-consumed',
  requireGroupMember('groupId'),
  clampQuery('limit', { min: 1, max: 20, fallback: 3 })
);
consumptions.get('/:id', async (req, res, next) => {
  const { id } = req.params;
  if (id === 'stats') return next();
  if (!INT_RE.test(id)) return res.status(400).json({ error: 'Invalid id' });
  const consumption = await prisma.consumption.findFirst({
    where: { ConsumptionID: parseInt(id, 10), isActive: true },
    select: { profileId: true, groupId: true },
  });
  if (!consumption) return next(); // handler answers 404
  if (consumption.profileId === actorId(req)) return next();
  if (consumption.groupId) {
    const access = await getGroupAccess(consumption.groupId, actorId(req));
    if (access.isMember) return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
});
consumptions.post('/individual', bindBody('profileId'), validateBody({ name: str({ min: 1, max: 120, required: true }), description: str({ max: 500 }), meals: array({ min: 1, max: 50, required: true }) }));
consumptions.post('/group', bindBody('profileId'), requireGroupMember('groupId', { source: 'body' }), validateBody({ name: str({ min: 1, max: 120, required: true }), description: str({ max: 500 }), meals: array({ min: 1, max: 50, required: true }) }));
consumptions.put('/:id', requireIntParam('id'), bindBody('profileId'), validateBody({ name: str({ min: 1, max: 120 }), description: str({ max: 500 }) }));
consumptions.delete('/:id', requireIntParam('id'), bindBody('profileId'));

// ---------------------------------------------------------------- voting
const voting = express.Router();
voting.get('/groups/:groupId/active', requireGroupMember('groupId'));
voting.post('/sessions/start', bindBody('initiatorId'), requireGroupMember('groupId', { source: 'body' }), validateBody({ title: str({ max: 120 }), description: str({ max: 500 }), totalDurationMinutes: int({ min: 2, max: 60 }) }));
// Every other /sessions/:sessionId/* route requires membership in the session's group.
voting.use('/sessions/:sessionId', requireSessionMember('sessionId'));
voting.post('/sessions/:sessionId/propose', bindBody('proposedById'));
voting.post('/sessions/:sessionId/vote', bindBody('voterId'));
voting.delete('/sessions/:sessionId/proposals/:proposalId/vote', bindBody('voterId'));
voting.post('/sessions/:sessionId/confirm-ready', bindBody('userId'));
voting.post('/sessions/:sessionId/confirm-votes', bindBody('userId'));
voting.post('/sessions/:sessionId/create-consumption', bindBody('profileId'));
voting.post('/sessions/:sessionId/force-close', bindBody('userId'));
voting.post('/sessions/:sessionId/complete', validateBody({ winnerProposalId: int({ min: 1 }) }));

// ---------------------------------------------------------------- voting history
const votingHistory = express.Router();
votingHistory.get(
  '/groups/:groupId',
  requireGroupMember('groupId'),
  clampQuery('limit', { min: 1, max: 50, fallback: 10 }),
  clampQuery('offset', { min: 0, max: 100000, fallback: 0 })
);
votingHistory.use('/sessions/:sessionId', requireSessionMember('sessionId'));
votingHistory.post('/sessions/:sessionId/portions', bindBody('userId'));
votingHistory.post('/sessions/:sessionId/track-participant', bindBody('userId'));
votingHistory.get('/sessions/:sessionId/participants/:userId', requireUuidParam('userId'));

// ---------------------------------------------------------------- meals
const meals = express.Router();
const mealBody = {
  name: str({ min: 1, max: 120 }),
  description: str({ max: 500 }),
};
meals.get('/recommended/:profileId', requireSelfParam('profileId'));
meals.post('/', bindBody('profileId'), validateBody({ ...mealBody, name: str({ min: 1, max: 120, required: true }) }));
meals.put('/:id', requireResourceOwner('meal'), validateBody(mealBody));
meals.delete('/:id', requireResourceOwner('meal'));

// ---------------------------------------------------------------- foods
const foods = express.Router();
foods.get('/recommended/:profileId', requireSelfParam('profileId'));
foods.post('/', bindBody('profileId'), validateBody({ name: str({ min: 1, max: 100, required: true }), svgLink: str({ max: 500 }) }), rejectUnsafeUrl('svgLink'));
foods.put('/:id', requireResourceOwner('food'), validateBody({ name: str({ min: 1, max: 100 }), svgLink: str({ max: 500 }) }), rejectUnsafeUrl('svgLink'));
foods.delete('/:id', requireResourceOwner('food'));

// ---------------------------------------------------------------- badges
const badges = express.Router();
badges.get('/user/:profileId', requireUuidParam('profileId'));
badges.get('/user/:profileId/progress', requireUuidParam('profileId'));
badges.get('/user/:profileId/stats', requireUuidParam('profileId'));
// Manual awarding is an admin tool; users earn badges through real activity only.
badges.post('/award', requireAdmin);
badges.post('/check', requireAdmin);
badges.post('/award-retroactive/:profileId', requireSelfParam('profileId'));

// ---------------------------------------------------------------- profile
const profile = express.Router();
const usernameRule = validateBody({ username: str({ min: 1, max: 30, required: true }) });
const prefsRule = validateBody({ preferences: intArray({ required: true }) });
const restrictionsRule = validateBody({ dietaryRestrictions: intArray({ required: true }) });

profile.get('/', requireAdmin); // full user directory is admin-only (users search via /groups/search/users)
profile.post('/', bindBody('id'), validateBody({ username: str({ min: 1, max: 30 }), preferences: intArray(), dietaryRestrictions: intArray() }));
profile.get('/:id/full', requireSelfParam('id'));
profile.patch('/:id/username', requireSelfParam('id'), usernameRule);
profile.patch('/:id/role', requireAdmin, validateBody({ role: oneOf(['admin', 'user'], { required: true }) }));
profile.patch('/:id', requireSelfParam('id'), usernameRule);
profile.post('/:id/preferences', requireSelfParam('id'), prefsRule);
profile.delete('/:id/preferences', requireSelfParam('id'), prefsRule);
profile.put('/:id/preferences', requireSelfParam('id'), prefsRule);
profile.post('/:id/dietary-restrictions', requireSelfParam('id'), restrictionsRule);
profile.delete('/:id/dietary-restrictions', requireSelfParam('id'), restrictionsRule);
profile.put('/:id/dietary-restrictions', requireSelfParam('id'), restrictionsRule);
profile.put('/:id/preferences-and-restrictions', requireSelfParam('id'), validateBody({ preferences: intArray(), dietaryRestrictions: intArray() }));
profile.delete('/:id', requireSelfParam('id', { allowAdmin: false }));
profile.put('/:id/calorie-goal', requireSelfParam('id'), validateBody({ calorieGoal: int({ min: 800, max: 5000, required: true }) }));
profile.get('/:id/calorie-progress', requireSelfParam('id'));
profile.put('/:id/primary-badge', requireSelfParam('id'));
profile.get('/:id', requireUuidParam('id'));
profile.get('/:id/badges', requireUuidParam('id'));
profile.get('/:id/badge-stats', requireUuidParam('id'));
profile.get('/:id/primary-badge', requireUuidParam('id'));

module.exports = { groups, consumptions, voting, votingHistory, meals, foods, badges, profile };
