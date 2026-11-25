const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const authenticateJWT = require('./auth');
const { requireAdmin, requireIntParam } = require('../middleware/authz');
const { validateBody, str } = require('../middleware/validate');

// GET /preferences - get all preferences (public: needed on the sign-up screen)
router.get('/', async (req, res) => {
  try {
    const preferences = await prisma.preference.findMany();
    res.json(preferences);
  } catch (err) {
    console.error('Error fetching preferences:', err);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// POST /preferences - create a new preference (admin only: this is a global catalog)
router.post('/', authenticateJWT, requireAdmin, validateBody({ name: str({ min: 1, max: 60, required: true }) }), async (req, res) => {
  try {
    const name = req.body.name.trim();
    const preference = await prisma.preference.create({ data: { name } });
    res.status(201).json(preference);
  } catch (err) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Preference with this name already exists' });
    } else {
      console.error('Error creating preference:', err);
      res.status(500).json({ error: 'Failed to create preference' });
    }
  }
});

// DELETE /preferences/:id - delete a preference by id (admin only)
router.delete('/:id', authenticateJWT, requireAdmin, requireIntParam('id'), async (req, res) => {
  try {
    await prisma.preference.delete({ where: { PreferenceID: parseInt(req.params.id, 10) } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Preference not found' });
    } else {
      console.error('Error deleting preference:', err);
      res.status(500).json({ error: 'Failed to delete preference' });
    }
  }
});

module.exports = router;
