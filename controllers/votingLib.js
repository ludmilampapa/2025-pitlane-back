const prisma = require('../lib/prisma');
const votingHistoryLib = require('./votingHistoryLib');
const BadgesLibrary = require('./badgesLib');
const { isMealCompatible } = require('../lib/dietaryCompatibility');
const { formatArgentinaDate } = require('../lib/timezone');

/**
 * Start a new voting session for a group
 */
async function startVotingSession(initiatorId, groupId, title = null, description = null) {
    // Verify the initiator is a member of the group
    const membership = await prisma.groupMember.findFirst({
        where: {
            profileId: initiatorId,
            groupId: parseInt(groupId),
            isActive: true
        }
    });

    if (!membership) {
        throw new Error('You must be a member of this group to start a voting session');
    }

    // Check if there's already an active voting session for this group
    const existingSession = await prisma.votingSession.findFirst({
        where: {
            groupId: parseInt(groupId),
            status: {
                in: ['proposal_phase', 'voting_phase']
            }
        }
    });

    if (existingSession) {
        throw new Error('There is already an active voting session for this group');
    }

    // Create the voting session with proposal phase ending in 5 minutes
    const proposalEndsAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

    const votingSession = await prisma.votingSession.create({
        data: {
            groupId: parseInt(groupId),
            initiatorId,
            title: title || `Meal Vote - ${formatArgentinaDate(new Date())}`,
            description,
            proposalEndsAt,
            status: 'proposal_phase'
        }
    });

    return getVotingSession(votingSession.VotingSessionID);
}

/**
 * Propose a meal for a voting session
 */
async function proposeMeal(votingSessionId, mealId, proposedById) {
    // Check if the voting session exists and is in proposal phase
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) },
        include: {
            group: {
                include: {
                    members: {
                        where: { isActive: true },
                        select: { profileId: true }
                    }
                }
            }
        }
    });

    if (!votingSession) {
        throw new Error('Voting session not found');
    }

    if (votingSession.status !== 'proposal_phase') {
        throw new Error('Proposal phase has ended');
    }

    // Check if proposal deadline has passed
    if (new Date() > votingSession.proposalEndsAt) {
        throw new Error('Proposal deadline has passed');
    }

    // Verify the proposer is a member of the group
    const isGroupMember = votingSession.group.members.some(
        member => member.profileId === proposedById
    );

    if (!isGroupMember) {
        throw new Error('You must be a member of this group to propose meals');
    }

    // Check if this meal has already been proposed in this session
    const existingProposal = await prisma.mealProposal.findFirst({
        where: {
            votingSessionId: parseInt(votingSessionId),
            mealId: parseInt(mealId),
            isActive: true
        }
    });

    if (existingProposal) {
        throw new Error('This meal has already been proposed in this voting session');
    }

    // Verify the meal exists
    const meal = await prisma.meal.findUnique({
        where: { MealID: parseInt(mealId) },
        include: {
            profile: {
                select: {
                    id: true,
                    username: true
                }
            },
            mealFoods: {
                include: {
                    food: {
                        include: {
                            preferences: true,
                            dietaryRestrictions: true
                        }
                    }
                }
            }
        }
    });

    if (!meal) {
        throw new Error('Meal not found');
    }

    // Create the meal proposal
    const mealProposal = await prisma.mealProposal.create({
        data: {
            votingSessionId: parseInt(votingSessionId),
            mealId: parseInt(mealId),
            proposedById
        },
        include: {
            meal: {
                include: {
                    profile: {
                        select: {
                            id: true,
                            username: true
                        }
                    },
                    mealFoods: {
                        include: {
                            food: {
                                select: {
                                    FoodID: true,
                                    name: true,
                                    kCal: true,
                                    preferences: true,
                                    dietaryRestrictions: true
                                }
                            }
                        }
                    }
                }
            },
            proposedBy: {
                select: {
                    id: true,
                    username: true
                }
            }
        }
    });

    return mealProposal;
}

/**
 * Populate random group-compatible meal proposals when a voting session enters voting_phase
 * without manual or swipe proposals.
 */
async function seedRandomProposalsIfEmpty(votingSession, count = 5) {
    const groupInfo = await prisma.group.findUnique({
        where: { GroupID: votingSession.groupId },
        include: {
            members: {
                where: { isActive: true },
                include: {
                    profile: {
                        include: {
                            DietaryRestriction: true
                        }
                    }
                }
            }
        }
    });

    const activeRestrictionsMap = new Map();
    if (groupInfo?.members) {
        groupInfo.members.forEach(member => {
            (member.profile?.DietaryRestriction || []).forEach(r => {
                if (r.DietaryRestrictionID && r.DietaryRestrictionID !== 0) {
                    activeRestrictionsMap.set(r.DietaryRestrictionID, r);
                }
            });
        });
    }

    const allMeals = await prisma.meal.findMany({
        include: {
            mealFoods: {
                include: {
                    food: {
                        include: {
                            dietaryRestrictions: true
                        }
                    }
                }
            }
        }
    });

    if (allMeals.length === 0) {
        throw new Error('Cannot start voting: no meals exist in the catalog yet');
    }

    const activeRestrictions = Array.from(activeRestrictionsMap.values());
    const candidatePool = activeRestrictions.length > 0
        ? allMeals.filter(meal => isMealCompatible(meal, activeRestrictions))
        : allMeals;

    if (candidatePool.length === 0) {
        throw new Error('No meals in the catalog match all dietary restrictions of this group');
    }

    // Fisher-Yates shuffle
    const shuffled = [...candidatePool];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selected = shuffled.slice(0, Math.min(count, shuffled.length));

    await prisma.mealProposal.createMany({
        data: selected.map(meal => ({
            votingSessionId: votingSession.VotingSessionID,
            mealId: meal.MealID,
            proposedById: votingSession.initiatorId
        })),
        skipDuplicates: true
    });
}

/**
 * Transition voting session from proposal to voting phase.
 * If no meals were proposed manually or via swipe, auto-seeds random compatible meals.
 */
async function startVotingPhase(votingSessionId) {
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) },
        include: {
            proposals: {
                where: { isActive: true }
            }
        }
    });

    if (!votingSession) {
        throw new Error('Voting session not found');
    }

    if (votingSession.status !== 'proposal_phase') {
        throw new Error('Voting session is not in proposal phase');
    }

    if (votingSession.proposals.length === 0) {
        await seedRandomProposalsIfEmpty(votingSession, 5);
    }

    // Set voting to end in 10 minutes (adjustable)
    const votingEndsAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.votingSession.update({
        where: { VotingSessionID: parseInt(votingSessionId) },
        data: {
            status: 'voting_phase',
            votingEndsAt
        }
    });

    return getVotingSession(votingSessionId);
}

/**
 * Cast a vote for a meal proposal
 */
async function castVote(votingSessionId, mealProposalId, voterId, voteType = 'up') {
    // Check if the voting session exists and is in voting phase
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) },
        include: {
            group: {
                include: {
                    members: {
                        where: { isActive: true },
                        select: { profileId: true }
                    }
                }
            }
        }
    });

    if (!votingSession) {
        throw new Error('Voting session not found');
    }

    if (votingSession.status !== 'voting_phase') {
        throw new Error('Voting is not currently active');
    }

    // Check if voting deadline has passed
    if (votingSession.votingEndsAt && new Date() > votingSession.votingEndsAt) {
        throw new Error('Voting deadline has passed');
    }

    // Verify the voter is a member of the group
    const isGroupMember = votingSession.group.members.some(
        member => member.profileId === voterId
    );

    if (!isGroupMember) {
        throw new Error('You must be a member of this group to vote');
    }

    // Check if meal proposal exists and is active
    const mealProposal = await prisma.mealProposal.findFirst({
        where: {
            MealProposalID: parseInt(mealProposalId),
            votingSessionId: parseInt(votingSessionId),
            isActive: true
        }
    });

    if (!mealProposal) {
        throw new Error('Meal proposal not found');
    }

    // Check if user has already voted for this proposal
    const existingVote = await prisma.vote.findFirst({
        where: {
            mealProposalId: parseInt(mealProposalId),
            voterId,
            isActive: true
        }
    });

    let vote;
    if (existingVote) {
        // Update existing vote
        vote = await prisma.vote.update({
            where: { VoteID: existingVote.VoteID },
            data: {
                voteType,
                votedAt: new Date()
            }
        });
    } else {
        // Create new vote
        vote = await prisma.vote.create({
            data: {
                votingSessionId: parseInt(votingSessionId),
                mealProposalId: parseInt(mealProposalId),
                voterId,
                voteType
            }
        });
    }

    // Update vote count on meal proposal
    const voteCount = await prisma.vote.count({
        where: {
            mealProposalId: parseInt(mealProposalId),
            voteType: 'up',
            isActive: true
        }
    });

    await prisma.mealProposal.update({
        where: { MealProposalID: parseInt(mealProposalId) },
        data: { voteCount }
    });

    // Track participant for portion selection
    try {
        await votingHistoryLib.trackParticipant(votingSessionId, voterId);
    } catch (error) {
        console.error('Error tracking participant:', error);
    }

    return vote;
}

/**
 * Undo a vote for a meal proposal
 */
async function undoVote(votingSessionId, mealProposalId, voterId) {
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) },
    });

    if (!votingSession) throw new Error('Voting session not found');
    if (votingSession.status !== 'voting_phase') throw new Error('Voting is not currently active');

    const existingVote = await prisma.vote.findFirst({
        where: {
            votingSessionId: parseInt(votingSessionId),
            mealProposalId: parseInt(mealProposalId),
            voterId,
            isActive: true,
        },
    });

    if (!existingVote) throw new Error('Active vote not found');

    await prisma.vote.update({
        where: { VoteID: existingVote.VoteID },
        data: { isActive: false },
    });

    const voteCount = await prisma.vote.count({
        where: {
            mealProposalId: parseInt(mealProposalId),
            voteType: 'up',
            isActive: true,
        },
    });

    await prisma.mealProposal.update({
        where: { MealProposalID: parseInt(mealProposalId) },
        data: { voteCount },
    });

    return { success: true, voteCount };
}

/**
 * Complete voting session and determine winner
 */
async function completeVotingSession(votingSessionId) {
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) },
        include: {
            proposals: {
                where: { isActive: true },
                include: {
                    meal: {
                        include: {
                            profile: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            },
                            mealFoods: {
                                include: {
                                    food: true
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    if (!votingSession) {
        throw new Error('Voting session not found');
    }

    if (votingSession.status !== 'voting_phase') {
        throw new Error('Voting session is not in voting phase');
    }

    // Find the proposal with the most votes
    const winnerProposal = votingSession.proposals.reduce((prev, current) => {
        return (current.voteCount > prev.voteCount) ? current : prev;
    }, votingSession.proposals[0]);

    if (!winnerProposal) {
        throw new Error('No proposals found to determine winner');
    }

    // Calculate total votes
    const totalVotes = await prisma.vote.count({
        where: {
            votingSessionId: parseInt(votingSessionId),
            voteType: 'up',
            isActive: true
        }
    });

    // Update voting session as completed
    const completedSession = await prisma.votingSession.update({
        where: { VotingSessionID: parseInt(votingSessionId) },
        data: {
            status: 'completed',
            completedAt: new Date(),
            winnerMealId: winnerProposal.mealId,
            totalVotes
        },
        include: {
            winnerMeal: {
                include: {
                    profile: {
                        select: {
                            id: true,
                            username: true
                        }
                    },
                    mealFoods: {
                        include: {
                            food: true
                        }
                    }
                }
            },
            group: {
                select: {
                    GroupID: true,
                    name: true
                }
            }
        }
    });

    // Award badge to winner meal creator
    try {
        if (completedSession.winnerMeal && completedSession.winnerMeal.profile) {
            const winnerId = completedSession.winnerMeal.profile.id;
            const badgeResult = await BadgesLibrary.checkAndAwardBadges(winnerId, 'voting_won');
            if (badgeResult.success && badgeResult.newlyEarnedBadges.length > 0) {
                console.log(`User ${winnerId} earned ${badgeResult.newlyEarnedBadges.length} new badge(s) for winning a vote!`);
                completedSession.winnerBadges = badgeResult.newlyEarnedBadges;
            }
        }
    } catch (badgeError) {
        console.error('Error awarding voting winner badge:', badgeError);
        // Don't fail the voting completion if badge awarding fails
    }

    // Update participant deadlines (15 minutes from now)
    try {
        await votingHistoryLib.updateParticipantDeadlines(votingSessionId);
        console.log(`Updated participant deadlines for session ${votingSessionId}`);
    } catch (error) {
        console.error(`Error updating participant deadlines:`, error);
    }

    // Automatically cleanup temporary data
    setTimeout(async () => {
        try {
            await cleanupVotingSession(votingSessionId);
            console.log(`Cleaned up voting session ${votingSessionId}`);
        } catch (error) {
            console.error(`Error cleaning up voting session ${votingSessionId}:`, error);
        }
    }, 5000); // Clean up after 5 seconds

    return {
        session: completedSession,
        winnerProposal,
        totalVotes
    };
}

/**
 * Get voting session details with proposals and votes
 */
async function getVotingSession(votingSessionId) {
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) },
        include: {
            group: {
                select: {
                    GroupID: true,
                    name: true,
                    description: true,
                    createdBy: true, // Added for ownership checks
                    members: {
                        where: { isActive: true },
                        select: {
                            role: true, // Added for admin checks
                            profile: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        }
                    }
                }
            },
            initiator: {
                select: {
                    id: true,
                    username: true
                }
            },
            winnerMeal: {
                include: {
                    profile: {
                        select: {
                            id: true,
                            username: true
                        }
                    },
                    mealFoods: {
                        include: {
                            food: {
                                select: {
                                    FoodID: true,
                                    name: true,
                                    kCal: true
                                }
                            }
                        }
                    }
                }
            },
            proposals: {
                where: { isActive: true },
                include: {
                    meal: {
                        include: {
                            profile: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            },
                            mealFoods: {
                                include: {
                                    food: {
                                        select: {
                                            FoodID: true,
                                            name: true,
                                            kCal: true,
                                            preferences: true,
                                            dietaryRestrictions: true
                                        }
                                    }
                                }
                            }
                        }
                    },
                    proposedBy: {
                        select: {
                            id: true,
                            username: true
                        }
                    },
                    votes: {
                        where: { isActive: true },
                        include: {
                            voter: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        }
                    }
                },
                orderBy: {
                    voteCount: 'desc'
                }
            },
            proposalConfirmations: {
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true
                        }
                    }
                }
            },
            voteConfirmations: {
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true
                        }
                    }
                }
            }
        }
    });

    if (!votingSession) {
        throw new Error('Voting session not found');
    }

    return votingSession;
}

/**
 * Get active voting sessions for a group.
 * Automatically transitions any expired proposal_phase -> voting_phase and
 * expired voting_phase -> completed so sessions never get stuck.
 */
async function getGroupActiveVotingSessions(groupId) {
    const parsedGroupId = parseInt(groupId);
    const now = new Date();

    const expiredProposals = await prisma.votingSession.findMany({
        where: {
            groupId: parsedGroupId,
            status: 'proposal_phase',
            proposalEndsAt: { lte: now }
        },
        select: { VotingSessionID: true }
    });
    for (const s of expiredProposals) {
        try {
            await startVotingPhase(s.VotingSessionID);
        } catch (err) {
            console.error(`Auto-transition proposal->voting failed for session ${s.VotingSessionID}:`, err);
        }
    }

    const expiredVotings = await prisma.votingSession.findMany({
        where: {
            groupId: parsedGroupId,
            status: 'voting_phase',
            votingEndsAt: { lte: now }
        },
        select: { VotingSessionID: true }
    });
    for (const s of expiredVotings) {
        try {
            await completeVotingSession(s.VotingSessionID);
        } catch (err) {
            console.error(`Auto-complete voting failed for session ${s.VotingSessionID}:`, err);
        }
    }

    const votingSessions = await prisma.votingSession.findMany({
        where: {
            groupId: parsedGroupId,
            status: {
                in: ['proposal_phase', 'voting_phase']
            }
        },
        include: {
            group: {
                select: {
                    GroupID: true,
                    name: true,
                    description: true,
                    createdBy: true,
                    members: {
                        where: { isActive: true },
                        select: {
                            role: true,
                            profile: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        }
                    }
                }
            },
            initiator: {
                select: {
                    id: true,
                    username: true
                }
            },
            proposals: {
                where: { isActive: true },
                select: {
                    MealProposalID: true,
                    mealId: true,
                    proposedById: true,
                    proposedAt: true,
                    voteCount: true,
                    isActive: true,
                    meal: {
                        select: {
                            MealID: true,
                            name: true,
                            description: true,
                            profileId: true,
                            profile: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            },
                            mealFoods: {
                                include: {
                                    food: {
                                        select: {
                                            FoodID: true,
                                            name: true,
                                            kCal: true,
                                            preferences: true,
                                            dietaryRestrictions: true
                                        }
                                    }
                                }
                            }
                        }
                    },
                    proposedBy: {
                        select: {
                            id: true,
                            username: true
                        }
                    },
                    votes: {
                        where: { isActive: true },
                        include: {
                            voter: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        }
                    }
                }
            },
            proposalConfirmations: {
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true
                        }
                    }
                }
            },
            voteConfirmations: {
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true
                        }
                    }
                }
            }
        },
        orderBy: {
            createdAt: 'desc'
        }
    });

    return votingSessions;
}

/**
 * Force-close (cancel) an active voting session in any phase (proposal_phase or voting_phase).
 * Allowed for the session initiator, group creator, or group admins.
 */
async function forceCloseVotingSession(votingSessionId, requesterId) {
    const parsedId = parseInt(votingSessionId);
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parsedId },
        include: {
            group: {
                select: {
                    GroupID: true,
                    createdBy: true,
                    members: {
                        where: { isActive: true },
                        select: { profileId: true, role: true }
                    }
                }
            }
        }
    });

    if (!votingSession) {
        throw new Error('Voting session not found');
    }

    if (!['proposal_phase', 'voting_phase'].includes(votingSession.status)) {
        throw new Error('Voting session is already closed');
    }

    const isInitiator = votingSession.initiatorId === requesterId;
    const isOwner = votingSession.group?.createdBy === requesterId;
    const isAdmin = votingSession.group?.members?.some(
        (m) => m.profileId === requesterId && m.role === 'admin'
    );

    if (!isInitiator && !isOwner && !isAdmin) {
        const err = new Error('Only the session host or group admins can force-close voting');
        err.statusCode = 403;
        throw err;
    }

    const cancelledSession = await prisma.votingSession.update({
        where: { VotingSessionID: parsedId },
        data: {
            status: 'cancelled',
            completedAt: new Date()
        }
    });

    try {
        await cleanupVotingSession(parsedId);
    } catch (cleanupErr) {
        console.error(`Error cleaning up force-closed voting session ${parsedId}:`, cleanupErr);
    }

    return cancelledSession;
}

/**
 * Auto-transition voting sessions based on time
 */
async function checkAndTransitionVotingSessions() {
    const now = new Date();

    // Find proposal phases that should transition to voting
    const proposalPhasesToTransition = await prisma.votingSession.findMany({
        where: {
            status: 'proposal_phase',
            proposalEndsAt: {
                lte: now
            }
        }
    });

    // Find voting phases that should complete
    const votingPhasesToComplete = await prisma.votingSession.findMany({
        where: {
            status: 'voting_phase',
            votingEndsAt: {
                lte: now
            }
        }
    });

    const results = [];

    // Transition proposal phases to voting
    for (const session of proposalPhasesToTransition) {
        try {
            const transitioned = await startVotingPhase(session.VotingSessionID);
            results.push({
                action: 'transitioned_to_voting',
                sessionId: session.VotingSessionID,
                session: transitioned
            });
        } catch (error) {
            console.error(`Error transitioning session ${session.VotingSessionID}:`, error);
        }
    }

    // Complete voting phases
    for (const session of votingPhasesToComplete) {
        try {
            const completed = await completeVotingSession(session.VotingSessionID);
            results.push({
                action: 'completed',
                sessionId: session.VotingSessionID,
                result: completed
            });
        } catch (error) {
            console.error(`Error completing session ${session.VotingSessionID}:`, error);
        }
    }

    return results;
}

/**
 * Mark user as ready for voting (proposal phase confirmation)
 */
async function confirmReadyForVoting(votingSessionId, userId) {
    // Check if the voting session exists and is in proposal phase
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) },
        include: {
            group: {
                include: {
                    members: {
                        where: { isActive: true },
                        select: { profileId: true, role: true }
                    }
                }
            },
            proposalConfirmations: {
                select: { userId: true }
            }
        }
    });

    if (!votingSession) {
        throw new Error('Voting session not found');
    }

    if (votingSession.status !== 'proposal_phase') {
        throw new Error('Can only confirm readiness during proposal phase');
    }

    // Verify the user is a member of the group
    const isGroupMember = votingSession.group.members.some(
        member => member.profileId === userId
    );

    if (!isGroupMember) {
        throw new Error('You must be a member of this group to confirm readiness');
    }

    // Check if user has already confirmed
    const existingConfirmation = await prisma.userProposalConfirmation.findFirst({
        where: {
            votingSessionId: parseInt(votingSessionId),
            userId
        }
    });

    if (existingConfirmation) {
        return existingConfirmation; // Already confirmed
    }

    // Create the confirmation
    const confirmation = await prisma.userProposalConfirmation.create({
        data: {
            votingSessionId: parseInt(votingSessionId),
            userId
        }
    });

    // Check if all users have confirmed readiness
    const totalMembers = votingSession.group.members.length;
    const totalConfirmations = votingSession.proposalConfirmations.length + 1; // +1 for this new confirmation

    // If all members have confirmed, automatically start voting phase
    if (totalConfirmations >= totalMembers) {
        const transitionResult = await startVotingPhase(votingSessionId);
        return {
            confirmation,
            votingStarted: true,
            transitionResult
        };
    }

    return {
        confirmation,
        votingStarted: false
    };
}

/**
 * Confirm user's votes (voting phase confirmation)
 */
async function confirmVotes(votingSessionId, userId) {
    // Check if the voting session exists and is in voting phase
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) },
        include: {
            group: {
                include: {
                    members: {
                        where: { isActive: true },
                        select: { profileId: true, role: true }
                    }
                }
            },
            voteConfirmations: {
                select: { userId: true }
            }
        }
    });

    if (!votingSession) {
        throw new Error('Voting session not found');
    }

    if (votingSession.status !== 'voting_phase') {
        throw new Error('Can only confirm votes during voting phase');
    }

    // Verify the user is a member of the group
    const isGroupMember = votingSession.group.members.some(
        member => member.profileId === userId
    );

    if (!isGroupMember) {
        throw new Error('You must be a member of this group to confirm votes');
    }

    // Check if user has already confirmed
    const existingConfirmation = await prisma.userVoteConfirmation.findFirst({
        where: {
            votingSessionId: parseInt(votingSessionId),
            userId
        }
    });

    if (existingConfirmation) {
        return existingConfirmation; // Already confirmed
    }

    // Create the confirmation
    const confirmation = await prisma.userVoteConfirmation.create({
        data: {
            votingSessionId: parseInt(votingSessionId),
            userId
        }
    });

    // Check if all users have confirmed their votes
    const totalMembers = votingSession.group.members.length;
    const totalConfirmations = votingSession.voteConfirmations.length + 1; // +1 for this new confirmation

    // If all members have confirmed, automatically complete voting
    if (totalConfirmations >= totalMembers) {
        const completionResult = await completeVotingSession(votingSessionId);
        return {
            confirmation,
            votingCompleted: true,
            completionResult
        };
    }

    return {
        confirmation,
        votingCompleted: false
    };
}

/**
 * Clean up temporary voting data after session completion
 */
async function cleanupVotingSession(votingSessionId) {
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) }
    });

    if (!votingSession) {
        throw new Error('Voting session not found');
    }

    if (votingSession.status !== 'completed') {
        throw new Error('Can only cleanup completed voting sessions');
    }

    // Clean up in transaction to ensure data consistency
    const cleanupResult = await prisma.$transaction(async (tx) => {
        // Delete user confirmations
        const deletedProposalConfirmations = await tx.userProposalConfirmation.deleteMany({
            where: { votingSessionId: parseInt(votingSessionId) }
        });

        const deletedVoteConfirmations = await tx.userVoteConfirmation.deleteMany({
            where: { votingSessionId: parseInt(votingSessionId) }
        });

        // Delete votes (keep vote stats but mark as archived)
        const deletedVotes = await tx.vote.updateMany({
            where: { votingSessionId: parseInt(votingSessionId) },
            data: { isActive: false }
        });

        // Delete meal proposals (keep the proposals but mark as inactive)
        const deletedProposals = await tx.mealProposal.updateMany({
            where: { votingSessionId: parseInt(votingSessionId) },
            data: { isActive: false }
        });

        return {
            deletedProposalConfirmations: deletedProposalConfirmations.count,
            deletedVoteConfirmations: deletedVoteConfirmations.count,
            archivedVotes: deletedVotes.count,
            archivedProposals: deletedProposals.count
        };
    });

    return cleanupResult;
}

/**
 * Get confirmation status for a voting session
 */
async function getConfirmationStatus(votingSessionId) {
    const votingSession = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) },
        include: {
            group: {
                include: {
                    members: {
                        where: { isActive: true },
                        select: { 
                            profileId: true, 
                            role: true,
                            profile: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        }
                    }
                }
            },
            proposalConfirmations: {
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true
                        }
                    }
                }
            },
            voteConfirmations: {
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true
                        }
                    }
                }
            }
        }
    });

    if (!votingSession) {
        throw new Error('Voting session not found');
    }

    const totalMembers = votingSession.group.members.length;
    const proposalConfirmedCount = votingSession.proposalConfirmations.length;
    const voteConfirmedCount = votingSession.voteConfirmations.length;

    const proposalConfirmedUsers = votingSession.proposalConfirmations.map(c => c.user);
    const voteConfirmedUsers = votingSession.voteConfirmations.map(c => c.user);

    const pendingProposalUsers = votingSession.group.members
        .filter(member => !proposalConfirmedUsers.some(confirmed => confirmed.id === member.profileId))
        .map(member => member.profile);

    const pendingVoteUsers = votingSession.group.members
        .filter(member => !voteConfirmedUsers.some(confirmed => confirmed.id === member.profileId))
        .map(member => member.profile);

    return {
        totalMembers,
        proposalPhase: {
            confirmedCount: proposalConfirmedCount,
            pendingCount: totalMembers - proposalConfirmedCount,
            confirmedUsers: proposalConfirmedUsers,
            pendingUsers: pendingProposalUsers,
            allConfirmed: proposalConfirmedCount >= totalMembers
        },
        votingPhase: {
            confirmedCount: voteConfirmedCount,
            pendingCount: totalMembers - voteConfirmedCount,
            confirmedUsers: voteConfirmedUsers,
            pendingUsers: pendingVoteUsers,
            allConfirmed: voteConfirmedCount >= totalMembers
        }
    };
}
async function createGroupConsumptionFromVote(votingSessionId, consumptionData) {
    const session = await prisma.votingSession.findUnique({
        where: { VotingSessionID: parseInt(votingSessionId) },
        include: {
            winnerMeal: {
                include: {
                    mealFoods: {
                        include: {
                            food: true
                        }
                    }
                }
            },
            group: true
        }
    });

    if (!session) {
        throw new Error('Voting session not found');
    }

    if (session.status !== 'completed') {
        throw new Error('Voting session is not completed yet');
    }

    if (!session.winnerMeal) {
        throw new Error('No winner meal found for this voting session');
    }

    // Calculate total kcal for the winning meal
    const totalKcal = session.winnerMeal.mealFoods.reduce((sum, mealFood) => 
        sum + (mealFood.food.kCal * mealFood.quantity), 0
    );

    // Create the group consumption
    const consumption = await prisma.consumption.create({
        data: {
            name: consumptionData.name || session.winnerMeal.name,
            description: consumptionData.description || `Group meal from voting session: ${session.title}`,
            type: 'group',
            profileId: consumptionData.profileId,
            groupId: session.groupId,
            totalKcal,
            consumedAt: consumptionData.consumedAt ? new Date(consumptionData.consumedAt) : new Date(),
            consumptionMeals: {
                create: [{
                    mealId: session.winnerMealId,
                    quantity: consumptionData.quantity || 1
                }]
            }
        },
        include: {
            consumptionMeals: {
                include: {
                    meal: {
                        include: {
                            profile: {
                                select: {
                                    id: true,
                                    username: true,
                                    role: true
                                }
                            },
                            mealFoods: {
                                include: {
                                    food: {
                                        include: {
                                            dietaryRestrictions: true,
                                            preferences: true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            profile: {
                select: {
                    id: true,
                    username: true,
                    role: true
                }
            },
            group: {
                select: {
                    GroupID: true,
                    name: true,
                    description: true
                }
            }
        }
    });

    return consumption;
}

module.exports = {
    startVotingSession,
    proposeMeal,
    startVotingPhase,
    castVote,
    undoVote,
    completeVotingSession,
    forceCloseVotingSession,
    getVotingSession,
    getGroupActiveVotingSessions,
    checkAndTransitionVotingSessions,
    createGroupConsumptionFromVote,
    confirmReadyForVoting,
    confirmVotes,
    cleanupVotingSession,
    getConfirmationStatus
};