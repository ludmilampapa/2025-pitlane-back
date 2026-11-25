const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const authenticateJWT = require('./auth');
const { requireAdmin, requireIntParam } = require('../middleware/authz');
const { validateBody, str } = require('../middleware/validate');

// GET /dietary-restrictions - get all dietary restrictions (public: needed on the sign-up screen)
router.get('/', async (req, res) => {
  try {
    const restrictions = await prisma.dietaryRestriction.findMany();
    res.json(restrictions);
  } catch (err) {
    console.error('Error fetching dietary restrictions:', err);
    res.status(500).json({ error: 'Failed to fetch dietary restrictions' });
  }
});

// GET /dietary-restrictions/excluding-for-everyone - get all restrictions except "For Everyone" (id = 0)
router.get('/excluding-for-everyone', async (req, res) => {
  try {
    const restrictions = await prisma.dietaryRestriction.findMany({
      where: {
        DietaryRestrictionID: {
          not: 0
        }
      }
    });
    res.json(restrictions);
  } catch (err) {
    console.error('Error fetching dietary restrictions:', err);
    res.status(500).json({ error: 'Failed to fetch dietary restrictions' });
  }
});

// POST /dietary-restrictions - create a new dietary restriction (admin only: global catalog)
router.post('/', authenticateJWT, requireAdmin, validateBody({ name: str({ min: 1, max: 60, required: true }) }), async (req, res) => {
  try {
    const name = req.body.name.trim();
    const restriction = await prisma.dietaryRestriction.create({ data: { name } });
    res.status(201).json(restriction);
  } catch (err) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Dietary restriction with this name already exists' });
    } else {
      console.error('Error creating dietary restriction:', err);
      res.status(500).json({ error: 'Failed to create dietary restriction' });
    }
  }
});

// DELETE /dietary-restrictions/:id - delete a dietary restriction by id (admin only)
router.delete('/:id', authenticateJWT, requireAdmin, requireIntParam('id'), async (req, res) => {
  try {
    await prisma.dietaryRestriction.delete({ where: { DietaryRestrictionID: parseInt(req.params.id, 10) } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Dietary restriction not found' });
    } else {
      console.error('Error deleting dietary restriction:', err);
      res.status(500).json({ error: 'Failed to delete dietary restriction' });
    }
  }
});

module.exports = router;
