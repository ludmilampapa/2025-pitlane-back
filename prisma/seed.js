// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Create Preferences
  const preferenceNames = [
    'Healthy',
    'Vegan',
    'Vegetarian',
    'High Protein',
    'Mediterranean',
    'Asian',
    'Spicy',
  ];
  for (const name of preferenceNames) {
    await prisma.preference.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Create Dietary Restrictions
  const restrictionNames = [
    'Gluten Free',
    'Lactose Free',
    'Vegan',
    'Vegetarian',
    'Nut Free',
    'Sugar Free',
    'Low Sodium',
  ];
  for (const name of restrictionNames) {
    await prisma.dietaryRestriction.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Create Profile (only id and username)
  const testProfile = await prisma.profile.upsert({
    where: { username: 'testuser' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001', // Example UUID, replace as needed
      username: 'testuser',
    },
  });

  // Skip foods creation if they already exist to avoid conflicts

  // Create Badges
  console.log('Creating badges...');
  
  const groupCreatorBadge = await prisma.badge.upsert({
    where: { name: 'Group Creator' },
    update: {
      iconUrl: null,  
      badgeType: 'group_creation'
    },
    create: {
      name: 'Group Creator',
      description: 'Created your first group to share meals with friends',
      badgeType: 'group_creation',
      iconUrl: null,  
      requirements: 'Create at least 1 group',
      isActive: true,
    },
  });

  const votingParticipantBadge = await prisma.badge.upsert({
    where: { name: 'Democracy Enthusiast' },
    update: {
      iconUrl: null,  
      badgeType: 'voting_participation'
    },
    create: {
      name: 'Democracy Enthusiast',
      description: 'Participated in group meal voting sessions',
      badgeType: 'voting_participation',
      iconUrl: null,  
      requirements: 'Participate in at least 1 voting session',
      isActive: true,
    },
  });

  const votingWinnerBadge = await prisma.badge.upsert({
    where: { name: 'Taste Maker' },
    update: {
      iconUrl: null,  
      badgeType: 'voting_winner'
    },
    create: {
      name: 'Taste Maker',
      description: 'Your meal proposals have won group voting sessions',
      badgeType: 'voting_winner',
      iconUrl: null,  
      requirements: 'Win at least 1 voting session',
      isActive: true,
    },
  });

  const mealCreatorBadge = await prisma.badge.upsert({
    where: { name: 'Chef' },
    update: {
      iconUrl: null,  
      badgeType: 'meal_creation'
    },
    create: {
      name: 'Chef',
      description: 'Created and shared meal recipes with the community',
      badgeType: 'meal_creation',
      iconUrl: null,  
      requirements: 'Create at least 1 meal',
      isActive: true,
    },
  });

  console.log('Badges created successfully!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
