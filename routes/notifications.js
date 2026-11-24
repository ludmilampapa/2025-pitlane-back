const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

/**
 * GET /notifications
 * Returns live inbox notifications for the authenticated user:
 *  - Active group voting sessions (proposal_phase / voting_phase)
 *  - Pending weekly menu change proposals in the user's groups
 *  - Pending group invitations for the user
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const memberships = await prisma.groupMember.findMany({
      where: { profileId: userId, isActive: true },
      select: { groupId: true },
    });
    const groupIds = memberships.map((m) => m.groupId);
    const now = new Date();

    const [activeVotes, pendingMenuProposals, pendingInvitations] = await Promise.all([
      groupIds.length > 0
        ? prisma.votingSession.findMany({
            where: {
              groupId: { in: groupIds },
              status: { in: ['proposal_phase', 'voting_phase'] },
            },
            include: {
              group: { select: { GroupID: true, name: true } },
              initiator: { select: { id: true, username: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 15,
          })
        : Promise.resolve([]),

      groupIds.length > 0
        ? prisma.menuProposal.findMany({
            where: {
              status: 'pending',
              menuEntry: {
                groupId: { in: groupIds },
                isActive: true,
              },
            },
            include: {
              proposedBy: { select: { id: true, username: true } },
              proposedMeal: { select: { MealID: true, name: true } },
              menuEntry: {
                select: {
                  MenuEntryID: true,
                  groupId: true,
                  date: true,
                  moment: true,
                  group: { select: { GroupID: true, name: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
          })
        : Promise.resolve([]),

      prisma.groupInvitation.findMany({
        where: {
          invitedUserId: userId,
          status: 'pending',
        },
        include: {
          group: { select: { GroupID: true, name: true } },
          invitedBy: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ]);

    const notifications = [];

    for (const session of activeVotes) {
      // Skip sessions whose timer clearly expired a long time ago (over 2 hours past end)
      const endRef =
        session.status === 'proposal_phase' ? session.proposalEndsAt : session.votingEndsAt;
      if (endRef && now.getTime() - new Date(endRef).getTime() > 2 * 60 * 60 * 1000) {
        continue;
      }

      const phaseLabel =
        session.status === 'proposal_phase' ? 'Proposal phase' : 'Voting phase';
      notifications.push({
        id: `voting-${session.VotingSessionID}-${session.status}`,
        type: 'voting',
        groupId: session.groupId,
        groupName: session.group?.name || 'Group',
        title: `Live vote in ${session.group?.name || 'your group'}`,
        description: `${session.initiator?.username || 'A member'} started a voting session (${phaseLabel}).`,
        href: `/protected/groups/${session.groupId}/voting`,
        createdAt: session.createdAt,
        meta: {
          votingSessionId: session.VotingSessionID,
          status: session.status,
        },
      });
    }

    for (const proposal of pendingMenuProposals) {
      const groupName = proposal.menuEntry?.group?.name || 'your group';
      const mealName =
        proposal.proposedMeal?.name || proposal.alternativeText || 'a menu change';
      const dateStr = proposal.menuEntry?.date
        ? new Date(proposal.menuEntry.date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          })
        : '';
      const momentLabel = proposal.menuEntry?.moment || 'meal';

      notifications.push({
        id: `menu-proposal-${proposal.ProposalID}`,
        type: 'menu_proposal',
        groupId: proposal.menuEntry?.groupId,
        groupName,
        title: `Menu change proposal in ${groupName}`,
        description: `${proposal.proposedBy?.username || 'A member'} proposed "${mealName}" for ${dateStr} (${momentLabel}).`,
        href: `/protected/groups/${proposal.menuEntry?.groupId}/menu`,
        createdAt: proposal.createdAt,
        meta: {
          proposalId: proposal.ProposalID,
          proposedById: proposal.proposedById,
        },
      });
    }

    for (const inv of pendingInvitations) {
      const groupName = inv.group?.name || 'a group';
      notifications.push({
        id: `invitation-${inv.InvitationID}`,
        type: 'group_invitation',
        groupId: inv.groupId,
        groupName,
        title: `Invitation to join ${groupName}`,
        description: `${inv.invitedBy?.username || 'Someone'} invited you to join ${groupName}.`,
        href: '/protected/groups',
        createdAt: inv.createdAt,
        meta: {
          invitationId: inv.InvitationID,
        },
      });
    }

    notifications.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const counts = {
      total: notifications.length,
      voting: notifications.filter((n) => n.type === 'voting').length,
      menuProposals: notifications.filter((n) => n.type === 'menu_proposal').length,
      invitations: notifications.filter((n) => n.type === 'group_invitation').length,
    };

    return res.json({ notifications, counts });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    return res.status(500).json({ error: 'Failed to load notifications' });
  }
});

module.exports = router;
