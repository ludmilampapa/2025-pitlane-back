const express = require('express');
const router = express.Router();
const lib = require('../controllers/groupChallengesLib');
const { requireIntParam } = require('../middleware/authz');
const { validateBody, str, oneOf } = require('../middleware/validate');

const challengeBodyRule = validateBody({
  name: str({ min: 1, max: 120 }),
  description: str({ max: 500 }),
  ruleText: str({ max: 300 }),
  targetPercentage: oneOf([50, 75, 100]),
});

const menuEntryBodyRule = validateBody({
  moment: oneOf(['breakfast', 'lunch', 'snack', 'dinner']),
  customMeal: str({ max: 120 }),
});

const proposalBodyRule = validateBody({
  alternativeText: str({ max: 200 }),
  reason: str({ max: 500 }),
});

const respondProposalBodyRule = validateBody({
  status: oneOf(['accepted', 'rejected'], { required: true }),
});

function errorStatus(error) {
  if (['FORBIDDEN_MEMBERSHIP', 'FORBIDDEN_ADMIN'].includes(error.message)) return 403;
  if (['CHALLENGE_NOT_FOUND', 'MENU_ENTRY_NOT_FOUND', 'PROPOSAL_NOT_FOUND', 'MEAL_NOT_FOUND'].includes(error.message)) return 404;
  if (error.message.startsWith('INVALID') || error.message === 'DATE_OUT_OF_CHALLENGE' || error.message === 'PROPOSAL_ALREADY_RESOLVED') return 400;
  return 500;
}

// Always derive the acting user from the verified JWT payload (req.user.sub)
function actorId(req) {
  return req.user?.sub;
}

router.get('/challenges/active-paused', async (req, res) => {
  try { res.json(await lib.listActivePausedChallenges(actorId(req), req.query.date)); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.get('/groups/:groupId/challenges', requireIntParam('groupId'), async (req, res) => {
  try { res.json(await lib.listChallenges(req.params.groupId, actorId(req))); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.post('/groups/:groupId/challenges', requireIntParam('groupId'), challengeBodyRule, async (req, res) => {
  try { res.status(201).json(await lib.createChallenge(req.params.groupId, actorId(req), req.body)); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.put('/challenges/:challengeId', requireIntParam('challengeId'), challengeBodyRule, async (req, res) => {
  try { res.json(await lib.updateChallenge(req.params.challengeId, actorId(req), req.body)); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.delete('/challenges/:challengeId', requireIntParam('challengeId'), async (req, res) => {
  try { res.json(await lib.deleteChallenge(req.params.challengeId, actorId(req))); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.post('/challenges/:challengeId/completions', requireIntParam('challengeId'), async (req, res) => {
  try { res.json(await lib.setCompletion(req.params.challengeId, actorId(req), req.body.date, req.body.completed)); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.get('/challenges/:challengeId/progress/:profileId', requireIntParam('challengeId'), async (req, res) => {
  try { res.json(await lib.getChallengeProgress(req.params.challengeId, actorId(req), req.query.date)); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.get('/challenges/:challengeId/ranking/:requesterId', requireIntParam('challengeId'), async (req, res) => {
  try { res.json(await lib.getChallengeRanking(req.params.challengeId, actorId(req))); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.get('/groups/:groupId/menu', requireIntParam('groupId'), async (req, res) => {
  try { res.json(await lib.listMenu(req.params.groupId, actorId(req), req.query.weekStart)); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.post('/groups/:groupId/menu', requireIntParam('groupId'), menuEntryBodyRule, async (req, res) => {
  try { res.status(201).json(await lib.createMenuEntry(req.params.groupId, actorId(req), req.body)); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.put('/menu/:entryId', requireIntParam('entryId'), menuEntryBodyRule, async (req, res) => {
  try { res.json(await lib.updateMenuEntry(req.params.entryId, actorId(req), req.body)); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.delete('/menu/:entryId', requireIntParam('entryId'), async (req, res) => {
  try { res.json(await lib.deleteMenuEntry(req.params.entryId, actorId(req))); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.get('/menu/:entryId/proposals', requireIntParam('entryId'), async (req, res) => {
  try { res.json(await lib.listProposals(req.params.entryId, actorId(req))); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.post('/menu/:entryId/proposals', requireIntParam('entryId'), proposalBodyRule, async (req, res) => {
  try { res.status(201).json(await lib.createProposal(req.params.entryId, actorId(req), req.body)); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

router.put('/menu-proposals/:proposalId/respond', requireIntParam('proposalId'), respondProposalBodyRule, async (req, res) => {
  try { res.json(await lib.respondProposal(req.params.proposalId, actorId(req), req.body.status)); }
  catch (error) { res.status(errorStatus(error)).json({ error: error.message }); }
});

module.exports = router;
