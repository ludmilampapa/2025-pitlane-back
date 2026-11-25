// Shared dietary & ingredient allergen compatibility rules for backend controllers.

const PLANT_SAFE_EXCEPTIONS = [
  'soy milk',
  'almond milk',
  'oat milk',
  'coconut milk',
  'rice milk',
  'coconut cream',
  'leche de almendra',
  'leche de soja',
  'leche de avena',
  'leche de coco',
  'crema de coco',
  'peanut butter',
  'almond butter',
  'cocoa butter',
  'manteca de mani',
  'manteca de maní',
  'manteca de cacao',
  'eggplant',
  'berenjena',
  'butternut',
];

const GLUTEN_FREE_EXCEPTIONS = [
  'gluten free',
  'gluten-free',
  'sin tacc',
  'sin gluten',
  'rice flour',
  'harina de arroz',
  'corn flour',
  'harina de maiz',
  'harina de maíz',
  'almond flour',
  'harina de almendra',
  'chickpea flour',
  'harina de garbanzo',
  'oat flour',
  'rice noodle',
  'fideos de arroz',
  'buckwheat',
  'trigo sarraceno',
];

const MEAT_AND_SEAFOOD = [
  'beef', 'bife', 'carne', 'steak', 'asado', 'veal', 'ternera', 'vacuno',
  'pork', 'cerdo', 'bacon', 'panceta', 'ham', 'jamon', 'jamón', 'chorizo',
  'salami', 'salame', 'sausage', 'salchicha', 'prosciutto', 'pepperoni',
  'chicken', 'pollo', 'turkey', 'pavo', 'duck', 'pato', 'lamb', 'cordero',
  'meat', 'mince', 'picada', 'milanesa', 'burger', 'hamburguesa',
  'fish', 'pescado', 'salmon', 'salmón', 'tuna', 'atun', 'atún', 'cod',
  'merluza', 'trout', 'trucha', 'hake', 'sardine', 'sardina', 'anchovy', 'anchoa',
  'shrimp', 'camaron', 'camarón', 'prawn', 'langostino', 'crab', 'cangrejo',
  'lobster', 'squid', 'calamar', 'octopus', 'pulpo', 'mussel', 'mejillon',
  'clam', 'oyster', 'seafood', 'marisco', 'gelatin', 'gelatina', 'lard',
];

const DAIRY_TERMS = [
  'milk', 'leche', 'cheese', 'queso', 'mozzarella', 'parmesan', 'parmesano',
  'cheddar', 'ricotta', 'provolone', 'gouda', 'brie', 'camembert', 'feta',
  'mascarpone', 'roquefort', 'blue cheese', 'gruyere', 'butter', 'manteca',
  'mantequilla', 'cream', 'crema', 'yogurt', 'yoghurt', 'yogur', 'whey',
  'suero', 'ghee', 'ice cream', 'helado', 'dulce de leche', 'condensed milk',
];

const EGG_AND_HONEY_TERMS = [
  'egg', 'eggs', 'huevo', 'huevos', 'mayonnaise', 'mayonesa', 'meringue',
  'merengue', 'honey', 'miel',
];

const GLUTEN_TERMS = [
  'wheat', 'trigo', 'flour', 'harina', 'bread', 'pan', 'baguette', 'brioche',
  'croissant', 'toast', 'tostada', 'pasta', 'spaghetti', 'macaroni', 'penne',
  'fettuccine', 'tagliatelle', 'rigatoni', 'lasagna', 'lasaña', 'ravioli',
  'gnocchi', 'ñoqui', 'noodle', 'fideo', 'ramen', 'udon', 'couscous', 'cuscus',
  'bulgur', 'seitan', 'seitán', 'barley', 'cebada', 'rye', 'centeno', 'malt',
  'malta', 'breadcrumbs', 'pan rallado', 'rebozado', 'empanada', 'pizza',
  'soy sauce', 'salsa de soja', 'biscuit', 'cookie', 'galleta', 'galletita',
  'cake', 'torta', 'pastry', 'hojaldre', 'tortilla de trigo', 'beer', 'cerveza',
  'morcilla', 'chorizo',
];

const NUT_TERMS = [
  'peanut', 'mani', 'maní', 'almond', 'almendra', 'walnut', 'nuez', 'nueces',
  'cashew', 'caju', 'castaña', 'hazelnut', 'avellana', 'pistachio', 'pistacho',
  'pecan', 'macadamia', 'pine nut', 'piñon', 'piñón', 'praline', 'nutella',
];

const SUGAR_TERMS = [
  'sugar', 'azucar', 'azúcar', 'syrup', 'jarabe', 'honey', 'miel', 'caramel',
  'caramelo', 'dulce de leche', 'jam', 'mermelada', 'chocolate', 'candy',
];

const HIGH_CARB_TERMS = [
  ...SUGAR_TERMS,
  'bread', 'pan', 'pasta', 'spaghetti', 'rice', 'arroz', 'potato', 'papa',
  'patata', 'flour', 'harina', 'corn', 'choclo', 'maiz', 'maíz', 'oats', 'avena',
];

const HIGH_SODIUM_TERMS = [
  'salt', 'sal', 'soy sauce', 'salsa de soja', 'bacon', 'panceta', 'salami',
  'salame', 'ham', 'jamon', 'jamón', 'prosciutto', 'anchovy', 'anchoa', 'bouillon',
];

function containsTerm(text, terms) {
  if (!text) return false;
  const lower = ` ${text.toLowerCase()} `;
  return terms.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-záéíóúñ])${escaped}(s|es)?([^a-záéíóúñ]|$)`, 'i');
    return re.test(lower);
  });
}

function violatesRestrictionByName(textToCheck, restrictionName) {
  if (!textToCheck || !restrictionName) return false;
  const lowerText = textToCheck.toLowerCase();
  const r = restrictionName.toLowerCase();

  const hasPlantException = PLANT_SAFE_EXCEPTIONS.some((ex) => lowerText.includes(ex));
  const hasGlutenFreeException = GLUTEN_FREE_EXCEPTIONS.some((ex) => lowerText.includes(ex));

  // Vegan / Vegano
  if (r.includes('vegan') || r.includes('vegano') || r.includes('plant')) {
    if (containsTerm(lowerText, MEAT_AND_SEAFOOD)) return true;
    if (!hasPlantException && containsTerm(lowerText, DAIRY_TERMS)) return true;
    if (!hasPlantException && containsTerm(lowerText, EGG_AND_HONEY_TERMS)) return true;
  }

  // Vegetarian / Vegetariano
  if (r.includes('vegetarian') || r.includes('vegetariano')) {
    if (containsTerm(lowerText, MEAT_AND_SEAFOOD)) return true;
  }

  // Gluten Free / Celiac / Sin TACC
  if (r.includes('gluten') || r.includes('tacc') || r.includes('celiac') || r.includes('celíac')) {
    if (!hasGlutenFreeException && containsTerm(lowerText, GLUTEN_TERMS)) return true;
  }

  // Lactose Free / Dairy Free / Sin Lactosa
  if (r.includes('lactos') || r.includes('dairy') || r.includes('lácteo') || r.includes('lacteo')) {
    if (!lowerText.includes('lactose free') && !lowerText.includes('sin lactosa') && !hasPlantException) {
      if (containsTerm(lowerText, DAIRY_TERMS)) return true;
    }
  }

  // Nut / Peanut Free
  if (r.includes('nut') || r.includes('mani') || r.includes('maní') || r.includes('frutos secos')) {
    if (containsTerm(lowerText, NUT_TERMS)) return true;
  }

  // Sugar Free / Diabetic
  if (r.includes('sugar') || r.includes('azucar') || r.includes('azúcar') || r.includes('diabet')) {
    if (!lowerText.includes('sugar free') && !lowerText.includes('sin azucar') && !lowerText.includes('sin azúcar')) {
      if (containsTerm(lowerText, SUGAR_TERMS)) return true;
    }
  }

  // Keto / Low Carb
  if (r.includes('keto') || r.includes('low carb') || r.includes('cetogen')) {
    if (containsTerm(lowerText, HIGH_CARB_TERMS)) return true;
  }

  // Low Sodium / Sin Sal / Hipertensión
  if (r.includes('sodium') || r.includes('sodio') || r.includes('sin sal') || r.includes('hipertens')) {
    if (containsTerm(lowerText, HIGH_SODIUM_TERMS)) return true;
  }

  return false;
}

function isFoodCompatible(food, activeRestrictions) {
  if (!activeRestrictions || activeRestrictions.length === 0) return true;
  if (!food) return true;

  // 1. Check ingredient name against each active restriction's allergen rules
  for (const req of activeRestrictions) {
    if (req.name && violatesRestrictionByName(food.name || '', req.name)) {
      return false;
    }
  }

  // 2. Check explicit dietaryRestriction tags on the food
  const raw = food.dietaryRestrictions || [];
  let isUniversal = false;
  const tagIds = new Set();

  for (const item of raw) {
    const id = typeof item === 'number' ? item : item?.DietaryRestrictionID;
    const name = (typeof item === 'object' && item?.name ? item.name : '').toLowerCase();
    if (id === 0 || name.includes('everyone')) {
      isUniversal = true;
    } else if (typeof id === 'number') {
      tagIds.add(id);
    }
  }

  if (isUniversal) return true;
  if (tagIds.size === 0) return false;
  return activeRestrictions.every((req) => tagIds.has(req.DietaryRestrictionID));
}

function isMealCompatible(meal, restrictions) {
  const active = (restrictions || []).filter(
    (r) =>
      r &&
      r.DietaryRestrictionID !== 0 &&
      !(r.name && r.name.toLowerCase().includes('everyone'))
  );
  if (active.length === 0) return true;
  if (!meal) return true;

  // Check meal title/description for obvious dish-level conflicts (e.g. "Beef Burger")
  for (const req of active) {
    if (req.name && violatesRestrictionByName(meal.name || '', req.name)) {
      return false;
    }
  }

  if (!meal.mealFoods || meal.mealFoods.length === 0) return true;
  return meal.mealFoods.every((mf) => isFoodCompatible(mf.food, active));
}

module.exports = {
  violatesRestrictionByName,
  isFoodCompatible,
  isMealCompatible,
};
