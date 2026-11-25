// middleware/authz.js
// Authorization primitives. Authentication (who you are) is done by routes/auth.js;
// everything here decides WHAT the authenticated user is allowed to touch.
const prisma = require('../lib/prisma');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^\d{1,9}$/;

const actorId = (req) => (req.user && req.user.sub) || null;
const deny = (res, message = 'Forbidden') => res.status(403).json({ error: message });
const badRequest = (res, message) => res.status(400).json({ error: message });

/** Site-wide admin (Profile.role === 'admin'). Cached per request. */
async function isAdmin(req) {
  if (req._isAdmin === undefined) {
    const profile = await prisma.profile.findUnique({
      where: { id: actorId(req) },
      select: { role: true },
    });
    req._isAdmin = !!profile && profile.role === 'admin';
  }
  return req._isAdmin;
}

/**
 * Express 5 exposes req.query as a getter that re-parses the URL on each access,
 * so mutating it is lost. Shadow it with an own property instead.
 */
function overrideQuery(req, patch) {
  Object.defineProperty(req, 'query', {
    value: { ...req.query, ...patch },
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

/** Group membership / group-admin lookup for the acting user. */
async function getGroupAccess(groupId, profileId) {
  const group = await prisma.group.findFirst({
    where: { GroupID: groupId, isActive: true },
    select: {
      createdBy: true,
      members: { where: { profileId, isActive: true }, select: { role: true } },
    },
  });
  if (!group) return { exists: false, isMember: false, isGroupAdmin: false };
  const member = group.members[0];
  const isCreator = group.createdBy === profileId;
  return {
    exists: true,
    isMember: isCreator || !!member,
    isGroupAdmin: isCreator || (!!member && member.role === 'admin'),
  };
}

/** Core group check used by the middlewares below. Returns true when the request may continue. */
async function checkGroup(req, res, rawGroupId, { adminOnly = false } = {}) {
  if (rawGroupId === undefined || !INT_RE.test(String(rawGroupId))) {
    badRequest(res, 'Invalid group id');
    return false;
  }
  const access = await getGroupAccess(parseInt(rawGroupId, 10), actorId(req));
  if (!access.exists) {
    res.status(404).json({ error: 'Group not found' });
    return false;
  }
  // Group privacy is strict: even platform catalog admins (Profile.role === 'admin')
  // can only access groups they created or joined via invitation.
  const allowed = adminOnly ? access.isGroupAdmin : access.isMember;
  if (!allowed) {
    deny(res, adminOnly ? 'Group admin permissions required' : 'You are not a member of this group');
    return false;
  }
  return true;
}

/** Overwrite client-supplied identity fields in the body with the verified JWT subject. */
function bindBody(...fields) {
  return (req, res, next) => {
    const sub = actorId(req);
    if (!sub) return res.status(401).json({ error: 'No autorizado' });
    req.body = req.body && typeof req.body === 'object' ? req.body : {};
    for (const field of fields) {
      const supplied = req.body[field];
      if (supplied !== undefined && supplied !== null && String(supplied) !== sub) {
        return deny(res, `${field} does not match the authenticated user`);
      }
      req.body[field] = sub;
    }
    return next();
  };
}

/** :param must be the acting user (site admins may act on any profile unless allowAdmin=false). */
function requireSelfParam(name = 'id', { allowAdmin = true } = {}) {
  return async (req, res, next) => {
    const value = req.params[name];
    const sub = actorId(req);
    if (value === sub) return next();
    if (!UUID_RE.test(String(value))) return badRequest(res, `Invalid ${name}`);
    if (allowAdmin && (await isAdmin(req))) return next();
    return deny(res, 'You can only access your own data');
  };
}

function requireAdmin(req, res, next) {
  isAdmin(req).then(
    (admin) => (admin ? next() : deny(res, 'Admin permissions required')),
    next
  );
}

function requireUuidParam(...names) {
  return (req, res, next) => {
    for (const name of names) {
      if (!UUID_RE.test(String(req.params[name]))) return badRequest(res, `Invalid ${name}`);
    }
    return next();
  };
}

function requireIntParam(...names) {
  return (req, res, next) => {
    for (const name of names) {
      if (!INT_RE.test(String(req.params[name]))) return badRequest(res, `Invalid ${name}`);
    }
    return next();
  };
}

/** Acting user must belong to the group in req.params[name] / req.body[name] / req.query[name]. */
function requireGroupMember(name = 'id', { source = 'params', adminOnly = false } = {}) {
  return async (req, res, next) => {
    const raw = (req[source] || {})[name];
    if (await checkGroup(req, res, raw, { adminOnly })) next();
  };
}

/** Acting user must belong to the group that owns the voting session in :param. */
function requireSessionMember(name = 'sessionId') {
  return async (req, res, next) => {
    const raw = req.params[name];
    if (raw === 'start' && req.method === 'POST') return next();
    if (!INT_RE.test(String(raw))) return badRequest(res, 'Invalid session id');
    const session = await prisma.votingSession.findUnique({
      where: { VotingSessionID: parseInt(raw, 10) },
      select: { groupId: true },
    });
    if (!session) return res.status(404).json({ error: 'Voting session not found' });
    if (await checkGroup(req, res, session.groupId)) next();
  };
}

/** Only the creator (profileId) of a Food / Meal, or a site admin, may modify or delete it. */
function requireResourceOwner(model) {
  const lookups = {
    food: (id) => prisma.food.findUnique({ where: { FoodID: id }, select: { profileId: true } }),
    meal: (id) => prisma.meal.findUnique({ where: { MealID: id }, select: { profileId: true } }),
  };
  return async (req, res, next) => {
    const raw = req.params.id;
    if (!INT_RE.test(String(raw))) return badRequest(res, 'Invalid id');
    const resource = await lookups[model](parseInt(raw, 10));
    if (!resource) return res.status(404).json({ error: `${model === 'food' ? 'Food' : 'Meal'} not found` });
    if (resource.profileId === actorId(req) || (await isAdmin(req))) return next();
    return deny(res, 'You can only modify resources you created');
  };
}

/** Clamp a numeric query param (limit / offset) so clients cannot request unbounded result sets. */
function clampQuery(name, { min = 0, max = 100, fallback }) {
  return (req, res, next) => {
    const raw = req.query[name];
    let value = raw === undefined ? fallback : parseInt(raw, 10);
    if (Number.isNaN(value)) value = fallback;
    if (value === undefined) return next();
    value = Math.min(Math.max(value, min), max);
    overrideQuery(req, { [name]: String(value) });
    return next();
  };
}

module.exports = {
  UUID_RE,
  INT_RE,
  actorId,
  isAdmin,
  overrideQuery,
  getGroupAccess,
  bindBody,
  requireSelfParam,
  requireAdmin,
  requireUuidParam,
  requireIntParam,
  requireGroupMember,
  requireSessionMember,
  requireResourceOwner,
  clampQuery,
};
