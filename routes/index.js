const express = require('express');
const router = express.Router();
const authenticateJWT = require('./auth');
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

// Read-only master catalogs
router.use('/preferences', preferencesRouter);
router.use('/dietary-restrictions', dietaryRestrictionsRouter);

// Authenticated application endpoints
router.use('/foods', authenticateJWT, foodsRouter);
router.use('/profile', profilesRouter); // profile.js already applies authenticateJWT per route
router.use('/meals', authenticateJWT, mealsRouter);
router.use('/groups', authenticateJWT, groupsRouter);
router.use('/consumptions', authenticateJWT, consumptionsRouter);
router.use('/voting', authenticateJWT, votingRouter);
router.use('/voting/history', authenticateJWT, votingHistoryRouter);
router.use('/badges', authenticateJWT, badgesRouter);
router.use('/notifications', authenticateJWT, notificationsRouter);
router.use('/', authenticateJWT, challengesRouter);

module.exports = router;
