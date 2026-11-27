require('dotenv').config();
const prisma = require('../lib/prisma');

function estimateIngredientKcal(name) {
  const lower = name.toLowerCase();
  if (/(salt|pepper|water|spice|herb|parsley|cilantro|coriander|basil|oregano|thyme|rosemary|cumin|paprika|cinnamon|ginger|garlic|bay leaf|chili|chilli|turmeric|vinegar|lemon|lime|tea|coffee)/.test(lower)) {
    return 10;
  }
  if (/(oil|butter|ghee|lard|mayonnaise|peanut|almond|walnut|cashew|nut|tahini|chocolate|sugar|honey|syrup)/.test(lower)) {
    return 140;
  }
  if (/(chicken|beef|pork|lamb|duck|turkey|bacon|sausage|ham|salmon|tuna|cod|shrimp|prawn|fish|meat|steak|mince)/.test(lower)) {
    return 185;
  }
  if (/(rice|pasta|noodle|spaghetti|macaroni|bread|flour|oats|potato|tortilla|couscous|quinoa|lentil|bean|chickpea)/.test(lower)) {
    return 160;
  }
  if (/(cheese|cream|milk|yogurt|egg|tofu|mozzarella|parmesan|cheddar|feta)/.test(lower)) {
    return 110;
  }
  if (/(tomato|onion|carrot|celery|spinach|lettuce|broccoli|pepper|mushroom|zucchini|courgette|aubergine|eggplant|cabbage|cucumber|pea|corn|apple|banana|orange|berry|fruit)/.test(lower)) {
    return 45;
  }
  return 85;
}

async function main() {
  // 1. Ensure svgLink column exists on meal table
  await prisma.$executeRawUnsafe(
    'ALTER TABLE meal ADD COLUMN IF NOT EXISTS "svgLink" TEXT;'
  );

  // 2. Find owner profile (prefer admin)
  const owner =
    (await prisma.profile.findFirst({ where: { role: 'admin' } })) ||
    (await prisma.profile.findFirst());
  if (!owner) {
    throw new Error('No profile found in database to own imported foods/meals.');
  }

  // Check if "For Everyone" restriction (id = 0) exists
  const everyoneRestriction = await prisma.dietaryRestriction.findUnique({
    where: { DietaryRestrictionID: 0 },
  });

  // 3. Fetch meals & ingredients from TheMealDB
  const [mealsRes, ingredientsRes] = await Promise.all([
    fetch('https://www.themealdb.com/api/json/v1/1/search.php?s=', {
      headers: { Accept: 'application/json' },
    }),
    fetch('https://www.themealdb.com/api/json/v1/1/list.php?i=list', {
      headers: { Accept: 'application/json' },
    }),
  ]);

  if (!mealsRes.ok || !ingredientsRes.ok) {
    throw new Error(`TheMealDB API error: meals=${mealsRes.status}, ingredients=${ingredientsRes.status}`);
  }

  const mealsJson = await mealsRes.json();
  const ingredientsJson = await ingredientsRes.json();
  const apiMeals = Array.isArray(mealsJson?.meals) ? mealsJson.meals : [];
  const apiIngredients = Array.isArray(ingredientsJson?.meals) ? ingredientsJson.meals : [];

  // Build map of existing foods (case-insensitive)
  const existingFoods = await prisma.food.findMany({
    select: { FoodID: true, name: true, svgLink: true },
  });
  const foodByLower = new Map(existingFoods.map((f) => [f.name.trim().toLowerCase(), f]));

  // Collect all ingredient names to ensure (first 80 from list + all ingredients used by meals)
  const ingredientNames = new Map();
  for (const item of apiIngredients.slice(0, 80)) {
    const clean = item.strIngredient?.trim();
    if (clean) ingredientNames.set(clean.toLowerCase(), clean);
  }
  for (const meal of apiMeals) {
    for (let i = 1; i <= 20; i++) {
      const clean = meal[`strIngredient${i}`]?.trim();
      if (clean) ingredientNames.set(clean.toLowerCase(), clean);
    }
  }

  let foodsCreated = 0;
  let foodsUpdated = 0;

  for (const [lower, name] of ingredientNames.entries()) {
    const thumb = `https://www.themealdb.com/images/ingredients/${encodeURIComponent(name)}-small.png`;
    const existing = foodByLower.get(lower);
    if (existing) {
      if (!existing.svgLink) {
        await prisma.food.update({
          where: { FoodID: existing.FoodID },
          data: { svgLink: thumb },
        });
        foodsUpdated += 1;
      }
      continue;
    }

    try {
      const created = await prisma.food.create({
        data: {
          name,
          svgLink: thumb,
          kCal: estimateIngredientKcal(name),
          profileId: owner.id,
          ...(everyoneRestriction
            ? { dietaryRestrictions: { connect: [{ DietaryRestrictionID: 0 }] } }
            : {}),
        },
        select: { FoodID: true, name: true, svgLink: true },
      });
      foodByLower.set(lower, created);
      foodsCreated += 1;
    } catch (err) {
      // Handle rare unique collision gracefully
      if (err?.code !== 'P2002') {
        console.warn(`Skipped food "${name}":`, err.message);
      }
    }
  }

  // Build map of existing meals (case-insensitive)
  const existingMeals = await prisma.meal.findMany({
    select: { MealID: true, name: true, svgLink: true },
  });
  const mealByLower = new Map(existingMeals.map((m) => [m.name.trim().toLowerCase(), m]));

  let mealsCreated = 0;
  let mealsUpdated = 0;

  for (const meal of apiMeals) {
    const name = meal.strMeal?.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    const thumb = meal.strMealThumb?.trim() || null;

    const existing = mealByLower.get(lower);
    if (existing) {
      if (!existing.svgLink && thumb) {
        await prisma.meal.update({
          where: { MealID: existing.MealID },
          data: { svgLink: thumb },
        });
        mealsUpdated += 1;
      }
      continue;
    }

    const seenFoodIds = new Set();
    const mealFoodsCreate = [];
    for (let i = 1; i <= 20; i++) {
      const ingName = meal[`strIngredient${i}`]?.trim();
      if (!ingName) continue;
      const food = foodByLower.get(ingName.toLowerCase());
      if (food && !seenFoodIds.has(food.FoodID)) {
        seenFoodIds.add(food.FoodID);
        mealFoodsCreate.push({ foodId: food.FoodID, quantity: 1 });
      }
    }
    if (mealFoodsCreate.length === 0) continue;

    const metaParts = [meal.strArea, meal.strCategory].filter(Boolean);
    const description =
      metaParts.length > 0
        ? `${metaParts.join(' · ')} dish from TheMealDB`
        : 'Dish from TheMealDB';

    const createdMeal = await prisma.meal.create({
      data: {
        name,
        description,
        svgLink: thumb,
        profileId: owner.id,
        mealFoods: {
          create: mealFoodsCreate,
        },
      },
      select: { MealID: true, name: true, svgLink: true },
    });
    mealByLower.set(lower, createdMeal);
    mealsCreated += 1;
  }

  console.log(
    JSON.stringify(
      {
        foodsCreated,
        foodsUpdated,
        mealsCreated,
        mealsUpdated,
        totalTheMealDBMeals: apiMeals.length,
        totalTheMealDBIngredientsProcessed: ingredientNames.size,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
