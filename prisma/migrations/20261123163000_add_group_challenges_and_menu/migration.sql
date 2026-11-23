-- CreateEnum
CREATE TYPE "MealMoment" AS ENUM ('breakfast', 'lunch', 'snack', 'dinner');

-- CreateEnum
CREATE TYPE "MenuProposalStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateTable
CREATE TABLE "groupchallenge" (
    "ChallengeID" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ruleText" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groupchallenge_pkey" PRIMARY KEY ("ChallengeID")
);

-- CreateTable
CREATE TABLE "groupchallengecompletion" (
    "CompletionID" SERIAL NOT NULL,
    "challengeId" INTEGER NOT NULL,
    "profileId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groupchallengecompletion_pkey" PRIMARY KEY ("CompletionID")
);

-- CreateTable
CREATE TABLE "groupmenuentry" (
    "MenuEntryID" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "moment" "MealMoment" NOT NULL,
    "mealId" INTEGER,
    "customMeal" TEXT,
    "createdById" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groupmenuentry_pkey" PRIMARY KEY ("MenuEntryID")
);

-- CreateTable
CREATE TABLE "menuproposal" (
    "ProposalID" SERIAL NOT NULL,
    "menuEntryId" INTEGER NOT NULL,
    "proposedById" UUID NOT NULL,
    "proposedMealId" INTEGER,
    "alternativeText" TEXT,
    "reason" TEXT,
    "status" "MenuProposalStatus" NOT NULL DEFAULT 'pending',
    "reviewedById" UUID,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menuproposal_pkey" PRIMARY KEY ("ProposalID")
);

-- CreateIndex
CREATE UNIQUE INDEX "groupchallengecompletion_challengeId_profileId_date_key" ON "groupchallengecompletion"("challengeId", "profileId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "groupmenuentry_groupId_date_moment_key" ON "groupmenuentry"("groupId", "date", "moment");

-- AddForeignKey
ALTER TABLE "groupchallenge" ADD CONSTRAINT "groupchallenge_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("GroupID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groupchallenge" ADD CONSTRAINT "groupchallenge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groupchallengecompletion" ADD CONSTRAINT "groupchallengecompletion_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "groupchallenge"("ChallengeID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groupchallengecompletion" ADD CONSTRAINT "groupchallengecompletion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groupmenuentry" ADD CONSTRAINT "groupmenuentry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("GroupID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groupmenuentry" ADD CONSTRAINT "groupmenuentry_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "meal"("MealID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groupmenuentry" ADD CONSTRAINT "groupmenuentry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menuproposal" ADD CONSTRAINT "menuproposal_menuEntryId_fkey" FOREIGN KEY ("menuEntryId") REFERENCES "groupmenuentry"("MenuEntryID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menuproposal" ADD CONSTRAINT "menuproposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menuproposal" ADD CONSTRAINT "menuproposal_proposedMealId_fkey" FOREIGN KEY ("proposedMealId") REFERENCES "meal"("MealID") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menuproposal" ADD CONSTRAINT "menuproposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
