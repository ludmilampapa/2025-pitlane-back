const prisma = require('../lib/prisma');
const { argentinaDateToUtcMidnight, getArgentinaDayBounds, getArgentinaYMD } = require('../lib/timezone');

function dayStart(value) {
  return argentinaDateToUtcMidnight(value);
}

function daysBetween(startDate, endDate) {
  const start = dayStart(startDate);
  const end = dayStart(endDate);
  return Math.max(1, Math.floor((end - start) / 86400000) + 1);
}

async function getGroupMembership(groupId, profileId) {
  return prisma.groupMember.findUnique({
    where: { groupId_profileId: { groupId: parseInt(groupId), profileId } },
  });
}

async function requireMember(groupId, profileId) {
  const membership = await getGroupMembership(groupId, profileId);
  if (!membership || !membership.isActive) throw new Error('FORBIDDEN_MEMBERSHIP');
  return membership;
}

async function requireAdmin(groupId, profileId) {
  const membership = await requireMember(groupId, profileId);
  const group = await prisma.group.findUnique({ where: { GroupID: parseInt(groupId) } });
  if (membership.role !== 'admin' && group?.createdBy !== profileId) throw new Error('FORBIDDEN_ADMIN');
  return membership;
}

async function listChallenges(groupId, requesterId) {
  await requireMember(groupId, requesterId);
  return prisma.groupChallenge.findMany({
    where: { groupId: parseInt(groupId), isActive: true },
    include: { createdBy: { select: { id: true, username: true } } },
    orderBy: { startDate: 'desc' },
  });
}

function normalizePausedFoods(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error('INVALID_CHALLENGE_DATA');
  const seen = new Set();
  const cleaned = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const item = raw.trim();
    if (!item || item.length > 60) continue;
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(item);
    }
    if (cleaned.length >= 20) break;
  }
  return cleaned;
}

async function createChallenge(groupId, profileId, data) {
  await requireAdmin(groupId, profileId);
  if (!data.name?.trim() || !data.ruleText?.trim() || !data.startDate || !data.endDate) {
    throw new Error('INVALID_CHALLENGE_DATA');
  }
  const startDate = dayStart(data.startDate);
  const endDate = dayStart(data.endDate);
  if (endDate < startDate) throw new Error('INVALID_CHALLENGE_DATES');
  const pausedFoods = normalizePausedFoods(data.pausedFoods);
  return prisma.groupChallenge.create({
    data: {
      groupId: parseInt(groupId),
      name: data.name.trim(),
      description: data.description?.trim() || null,
      ruleText: data.ruleText.trim(),
      pausedFoods,
      startDate,
      endDate,
      createdById: profileId,
    },
  });
}

async function updateChallenge(challengeId, profileId, data) {
  const challenge = await prisma.groupChallenge.findUnique({ where: { ChallengeID: parseInt(challengeId) } });
  if (!challenge) throw new Error('CHALLENGE_NOT_FOUND');
  await requireAdmin(challenge.groupId, profileId);
  const startDate = data.startDate ? dayStart(data.startDate) : challenge.startDate;
  const endDate = data.endDate ? dayStart(data.endDate) : challenge.endDate;
  if (endDate < startDate) throw new Error('INVALID_CHALLENGE_DATES');
  return prisma.groupChallenge.update({
    where: { ChallengeID: parseInt(challengeId) },
    data: {
      name: data.name?.trim() || challenge.name,
      description: data.description?.trim() ?? challenge.description,
      ruleText: data.ruleText?.trim() || challenge.ruleText,
      pausedFoods: data.pausedFoods !== undefined ? normalizePausedFoods(data.pausedFoods) : challenge.pausedFoods,
      startDate,
      endDate,
    },
  });
}

async function listActivePausedChallenges(profileId, clientDate) {
  const memberships = await prisma.groupMember.findMany({
    where: { profileId, isActive: true },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length === 0) return [];

  const todayDate = dayStart(clientDate || getArgentinaYMD(new Date()));
  const challenges = await prisma.groupChallenge.findMany({
    where: {
      groupId: { in: groupIds },
      isActive: true,
      startDate: { lte: todayDate },
      endDate: { gte: todayDate },
      pausedFoods: { isEmpty: false },
    },
    include: {
      group: { select: { GroupID: true, name: true } },
    },
    orderBy: { startDate: 'desc' },
  });

  return challenges.map((c) => ({
    ChallengeID: c.ChallengeID,
    name: c.name,
    ruleText: c.ruleText,
    pausedFoods: c.pausedFoods,
    groupId: c.groupId,
    groupName: c.group?.name || 'Your group',
  }));
}

function consumptionMatchesPausedFoods(consumption, pausedFoods) {
  if (!Array.isArray(pausedFoods) || pausedFoods.length === 0) return false;
  const needles = pausedFoods.map((p) => String(p).trim().toLowerCase()).filter(Boolean);
  if (needles.length === 0) return false;

  const texts = [];
  for (const cm of consumption.consumptionMeals || []) {
    if (cm.meal?.name) texts.push(cm.meal.name);
    if (cm.meal?.description) texts.push(cm.meal.description);
    for (const mf of cm.meal?.mealFoods || []) {
      if (mf.food?.name) texts.push(mf.food.name);
    }
  }
  const haystack = texts.join(' ').toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Automatically evaluates and upserts daily completion for all active challenges
 * with linked pausedFoods for a user on a given Argentina calendar day.
 * - Completed = user logged >= 1 active consumption that day AND none match any pausedFood.
 * - If a later consumption on the same day includes a pausedFood, it automatically unchecks.
 */
async function syncChallengeCompletionsForDay(profileId, dateValue = new Date()) {
  if (!profileId) return [];
  const { ymd, startUtc, endUtc } = getArgentinaDayBounds(dateValue);
  const dayDate = dayStart(ymd);

  const memberships = await prisma.groupMember.findMany({
    where: { profileId, isActive: true },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length === 0) return [];

  const challenges = await prisma.groupChallenge.findMany({
    where: {
      groupId: { in: groupIds },
      isActive: true,
      startDate: { lte: dayDate },
      endDate: { gte: dayDate },
      pausedFoods: { isEmpty: false },
    },
  });
  if (challenges.length === 0) return [];

  const dayConsumptions = await prisma.consumption.findMany({
    where: {
      profileId,
      isActive: true,
      consumedAt: { gte: startUtc, lte: endUtc },
    },
    include: {
      consumptionMeals: {
        include: {
          meal: {
            include: {
              mealFoods: {
                include: { food: true },
              },
            },
          },
        },
      },
    },
  });

  const results = [];
  for (const challenge of challenges) {
    const hasLoggedMeal = dayConsumptions.length > 0;
    const hasPausedMatch = dayConsumptions.some((c) =>
      consumptionMatchesPausedFoods(c, challenge.pausedFoods)
    );
    const completed = hasLoggedMeal && !hasPausedMatch;

    const record = await prisma.groupChallengeCompletion.upsert({
      where: {
        challengeId_profileId_date: {
          challengeId: challenge.ChallengeID,
          profileId,
          date: dayDate,
        },
      },
      update: { completed },
      create: {
        challengeId: challenge.ChallengeID,
        profileId,
        date: dayDate,
        completed,
      },
    });
    results.push({ challengeId: challenge.ChallengeID, completed: record.completed });
  }
  return results;
}

async function deleteChallenge(challengeId, profileId) {
  const challenge = await prisma.groupChallenge.findUnique({ where: { ChallengeID: parseInt(challengeId) } });
  if (!challenge) throw new Error('CHALLENGE_NOT_FOUND');
  await requireAdmin(challenge.groupId, profileId);
  return prisma.groupChallenge.update({ where: { ChallengeID: challenge.ChallengeID }, data: { isActive: false } });
}

async function setCompletion(challengeId, profileId, dateValue, completed) {
  const challenge = await prisma.groupChallenge.findUnique({ where: { ChallengeID: parseInt(challengeId) } });
  if (!challenge || !challenge.isActive) throw new Error('CHALLENGE_NOT_FOUND');
  await requireMember(challenge.groupId, profileId);
  if (Array.isArray(challenge.pausedFoods) && challenge.pausedFoods.length > 0) {
    throw new Error('INVALID_AUTO_TRACKED_CHALLENGE');
  }
  const date = dayStart(dateValue || new Date());
  if (date < dayStart(challenge.startDate) || date > dayStart(challenge.endDate)) throw new Error('DATE_OUT_OF_CHALLENGE');
  return prisma.groupChallengeCompletion.upsert({
    where: { challengeId_profileId_date: { challengeId: challenge.ChallengeID, profileId, date } },
    update: { completed: Boolean(completed) },
    create: { challengeId: challenge.ChallengeID, profileId, date, completed: Boolean(completed) },
  });
}

async function getChallengeProgress(challengeId, profileId, clientDate) {
  const challenge = await prisma.groupChallenge.findUnique({ where: { ChallengeID: parseInt(challengeId) } });
  if (!challenge) throw new Error('CHALLENGE_NOT_FOUND');
  await requireMember(challenge.groupId, profileId);
  const today =
    typeof clientDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(clientDate.trim())
      ? clientDate.trim()
      : getArgentinaYMD(new Date());
  if (Array.isArray(challenge.pausedFoods) && challenge.pausedFoods.length > 0) {
    try {
      await syncChallengeCompletionsForDay(profileId, today);
    } catch (syncError) {
      console.error('Error syncing challenge completion:', syncError);
    }
  }
  const completions = await prisma.groupChallengeCompletion.findMany({
    where: { challengeId: challenge.ChallengeID, profileId, completed: true },
    orderBy: { date: 'desc' },
  });
  const completedDates = completions.map((completion) => completion.date.toISOString().slice(0, 10));
  const completionSet = new Set(completedDates);
  let streak = 0;
  let cursor = dayStart(today);
  while (completionSet.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  const totalDays = daysBetween(challenge.startDate, challenge.endDate);
  return {
    challenge,
    completedDays: completions.length,
    completedDates,
    todayCompleted: completionSet.has(today),
    streak,
    totalDays,
    percentage: totalDays ? Math.round(completions.length * 100 / totalDays) : 0,
  };
}

async function getChallengeRanking(challengeId, requesterId) {
  const challenge = await prisma.groupChallenge.findUnique({ where: { ChallengeID: parseInt(challengeId) } });
  if (!challenge) throw new Error('CHALLENGE_NOT_FOUND');
  await requireMember(challenge.groupId, requesterId);
  const members = await prisma.groupMember.findMany({
    where: { groupId: challenge.groupId, isActive: true },
    include: { profile: { select: { id: true, username: true } } },
  });
  const totalDays = daysBetween(challenge.startDate, challenge.endDate);
  const counts = await prisma.groupChallengeCompletion.groupBy({
    by: ['profileId'],
    where: { challengeId: challenge.ChallengeID, completed: true },
    _count: { _all: true },
  });
  const countByProfile = new Map(counts.map((row) => [row.profileId, row._count._all]));
  const ranking = members.map((member) => {
    const completedDays = countByProfile.get(member.profileId) || 0;
    return {
      profileId: member.profileId,
      username: member.profile.username,
      completedDays,
      totalDays,
      percentage: totalDays ? Math.round((completedDays * 100) / totalDays) : 0,
    };
  });
  ranking.sort((a, b) => b.percentage - a.percentage || b.completedDays - a.completedDays || a.username?.localeCompare(b.username || '') || 0);
  return ranking;
}

async function listMenu(groupId, requesterId, weekStart) {
  await requireMember(groupId, requesterId);
  const start = dayStart(weekStart || new Date());
  const day = start.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + mondayOffset);
  const end = dayStart(start);
  end.setUTCDate(end.getUTCDate() + 6);

  const mealInclude = {
    include: {
      mealFoods: {
        include: {
          food: {
            select: {
              FoodID: true,
              name: true,
              kCal: true,
              dietaryRestrictions: true,
            },
          },
        },
      },
    },
  };

  return prisma.groupMenuEntry.findMany({
    where: {
      groupId: parseInt(groupId),
      isActive: true,
      moment: { in: VALID_MENU_MOMENTS },
      date: { gte: start, lte: end },
    },
    include: {
      meal: mealInclude,
      createdBy: { select: { id: true, username: true } },
      proposals: {
        include: {
          proposedBy: { select: { id: true, username: true } },
          proposedMeal: mealInclude,
          reviewedBy: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: [{ date: 'asc' }, { moment: 'asc' }],
  });
}

const VALID_MENU_MOMENTS = ['breakfast', 'lunch', 'snack', 'dinner'];

function normalizeMenuMoment(moment) {
  const normalized = typeof moment === 'string' ? moment.trim().toLowerCase() : '';
  if (!VALID_MENU_MOMENTS.includes(normalized)) {
    throw new Error('INVALID_MENU_MOMENT');
  }
  return normalized;
}

async function createMenuEntry(groupId, requesterId, data) {
  await requireAdmin(groupId, requesterId);
  if (!data.date || !data.moment) throw new Error('INVALID_MENU_DATA');
  const moment = normalizeMenuMoment(data.moment);
  if (!data.mealId) throw new Error('INVALID_MENU_MEAL');
  const parsedMealId = parseInt(data.mealId);
  if (!Number.isInteger(parsedMealId) || parsedMealId <= 0) throw new Error('INVALID_MENU_MEAL');
  const meal = await prisma.meal.findUnique({ where: { MealID: parsedMealId } });
  if (!meal) throw new Error('MEAL_NOT_FOUND');

  const parsedGroupId = parseInt(groupId);
  const parsedDate = dayStart(data.date);

  return prisma.groupMenuEntry.upsert({
    where: {
      groupId_date_moment: {
        groupId: parsedGroupId,
        date: parsedDate,
        moment,
      },
    },
    update: {
      mealId: parsedMealId,
      customMeal: null,
      createdById: requesterId,
      isActive: true,
    },
    create: {
      groupId: parsedGroupId,
      date: parsedDate,
      moment,
      mealId: parsedMealId,
      customMeal: null,
      createdById: requesterId,
      isActive: true,
    },
  });
}

async function updateMenuEntry(entryId, requesterId, data) {
  const entry = await prisma.groupMenuEntry.findUnique({ where: { MenuEntryID: parseInt(entryId) } });
  if (!entry) throw new Error('MENU_ENTRY_NOT_FOUND');
  await requireAdmin(entry.groupId, requesterId);
  let nextMealId = entry.mealId;
  if (data.mealId !== undefined) {
    const parsedMealId = parseInt(data.mealId);
    if (!Number.isInteger(parsedMealId) || parsedMealId <= 0) throw new Error('INVALID_MENU_MEAL');
    const meal = await prisma.meal.findUnique({ where: { MealID: parsedMealId } });
    if (!meal) throw new Error('MEAL_NOT_FOUND');
    nextMealId = parsedMealId;
  }
  return prisma.groupMenuEntry.update({
    where: { MenuEntryID: entry.MenuEntryID },
    data: {
      date: data.date ? dayStart(data.date) : entry.date,
      moment: data.moment ? normalizeMenuMoment(data.moment) : entry.moment,
      mealId: nextMealId,
      customMeal: null,
    },
  });
}

async function deleteMenuEntry(entryId, requesterId) {
  const entry = await prisma.groupMenuEntry.findUnique({ where: { MenuEntryID: parseInt(entryId) } });
  if (!entry) throw new Error('MENU_ENTRY_NOT_FOUND');
  await requireAdmin(entry.groupId, requesterId);
  return prisma.groupMenuEntry.update({ where: { MenuEntryID: entry.MenuEntryID }, data: { isActive: false } });
}

async function listProposals(entryId, requesterId) {
  const entry = await prisma.groupMenuEntry.findUnique({ where: { MenuEntryID: parseInt(entryId) } });
  if (!entry) throw new Error('MENU_ENTRY_NOT_FOUND');
  await requireMember(entry.groupId, requesterId);
  return prisma.menuProposal.findMany({
    where: { menuEntryId: entry.MenuEntryID },
    include: { proposedBy: { select: { id: true, username: true } }, proposedMeal: true, reviewedBy: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function createProposal(entryId, requesterId, data) {
  const entry = await prisma.groupMenuEntry.findUnique({ where: { MenuEntryID: parseInt(entryId) } });
  if (!entry) throw new Error('MENU_ENTRY_NOT_FOUND');
  await requireMember(entry.groupId, requesterId);
  if (!data.proposedMealId) throw new Error('INVALID_PROPOSAL');
  const parsedMealId = parseInt(data.proposedMealId);
  if (!Number.isInteger(parsedMealId) || parsedMealId <= 0) throw new Error('INVALID_PROPOSAL');
  const meal = await prisma.meal.findUnique({ where: { MealID: parsedMealId } });
  if (!meal) throw new Error('MEAL_NOT_FOUND');
  return prisma.menuProposal.create({
    data: {
      menuEntryId: entry.MenuEntryID,
      proposedById: requesterId,
      proposedMealId: parsedMealId,
      alternativeText: null,
      reason: data.reason?.trim() || null,
    },
  });
}

async function respondProposal(proposalId, requesterId, status) {
  const proposal = await prisma.menuProposal.findUnique({ where: { ProposalID: parseInt(proposalId) }, include: { menuEntry: true } });
  if (!proposal) throw new Error('PROPOSAL_NOT_FOUND');
  if (!['accepted', 'rejected'].includes(status)) throw new Error('INVALID_PROPOSAL_STATUS');
  await requireAdmin(proposal.menuEntry.groupId, requesterId);
  if (proposal.status !== 'pending') throw new Error('PROPOSAL_ALREADY_RESOLVED');
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.menuProposal.update({
      where: { ProposalID: proposal.ProposalID },
      data: { status, reviewedById: requesterId, respondedAt: new Date() },
    });
    if (status === 'accepted') {
      await tx.groupMenuEntry.update({
        where: { MenuEntryID: proposal.menuEntryId },
        data: {
          mealId: proposal.proposedMealId,
          customMeal: proposal.alternativeText,
        },
      });
    }
    return updated;
  });
  return result;
}

module.exports = {
  listChallenges, createChallenge, updateChallenge, deleteChallenge, setCompletion,
  getChallengeProgress, getChallengeRanking, listActivePausedChallenges,
  syncChallengeCompletionsForDay, consumptionMatchesPausedFoods,
  listMenu, createMenuEntry, updateMenuEntry, deleteMenuEntry,
  listProposals, createProposal, respondProposal,
};
