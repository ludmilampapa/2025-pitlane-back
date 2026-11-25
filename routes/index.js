const express = require('express');
const router = express.Router();
const authenticateJWT = require('./auth');
const guards = require('./guards');
const foodsRouter = require('./foods');
const profilesRouter = require('./profile');
const mealsRouter = require('./meals');
const groupsRouter = require('./groups');
const consumptionsRouter = require('./consumptions');
const votingRouter = require('./voting');
const votingHistoryRouter = require('./votingHistory');
const badgesRouter = require('./badges');
const challengesRouter = require('./challenges');
const notificationsRouter = require('./notifications');

const preferencesRouter = require('./preferences');
const dietaryRestrictionsRouter = require('./dietaryRestrictions');

// Master catalogs: GET is public (needed on sign-up), POST/DELETE require an admin (see each router)
router.use('/preferences', preferencesRouter);
router.use('/dietary-restrictions', dietaryRestrictionsRouter);

// Authenticated application endpoints. Every feature router is preceded by its authorization
// guard router (routes/guards.js): identity binding, ownership, group membership, validation.
router.use('/foods', authenticateJWT, guards.foods, foodsRouter);
router.use('/profile', authenticateJWT, guards.profile, profilesRouter);
router.use('/meals', authenticateJWT, guards.meals, mealsRouter);
router.use('/groups', authenticateJWT, guards.groups, groupsRouter);
router.use('/consumptions', authenticateJWT, guards.consumptions, consumptionsRouter);
// /voting/history must be mounted before /voting so the more specific prefix is matched first
router.use('/voting/history', authenticateJWT, guards.votingHistory, votingHistoryRouter);
router.use('/voting', authenticateJWT, guards.voting, votingRouter);
router.use('/badges', authenticateJWT, guards.badges, badgesRouter);
router.use('/notifications', authenticateJWT, notificationsRouter);
// challenges.js derives the acting user from req.user.sub and checks group membership in its lib
router.use('/', authenticateJWT, challengesRouter);

module.exports = router;
