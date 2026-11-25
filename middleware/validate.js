// middleware/validate.js
// Tiny dependency-free body validator. Usage:
//   validateBody({ name: str({ min: 1, max: 100, required: true }), kCal: int({ min: 0, max: 10000 }) })
// Fields that are absent (undefined/null) are only rejected when `required: true`.

const str = ({ min = 0, max = 255, required = false } = {}) => ({
  required,
  test: (v) => typeof v === 'string' && v.trim().length >= min && v.length <= max,
  message: `must be a string between ${min} and ${max} characters`,
});

const int = ({ min = -2147483648, max = 2147483647, required = false } = {}) => ({
  required,
  test: (v) => Number.isInteger(v) && v >= min && v <= max,
  message: `must be an integer between ${min} and ${max}`,
});

const oneOf = (values, { required = false } = {}) => ({
  required,
  test: (v) => values.includes(v),
  message: `must be one of: ${values.join(', ')}`,
});

const intArray = ({ max = 200, required = false } = {}) => ({
  required,
  test: (v) => Array.isArray(v) && v.length <= max && v.every((n) => Number.isInteger(n) && n >= 0),
  message: `must be an array of at most ${max} non-negative integers`,
});

const array = ({ min = 0, max = 100, required = false } = {}) => ({
  required,
  test: (v) => Array.isArray(v) && v.length >= min && v.length <= max,
  message: `must be an array with ${min} to ${max} items`,
});

function validateBody(rules) {
  return (req, res, next) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    for (const [field, rule] of Object.entries(rules)) {
      const value = body[field];
      if (value === undefined || value === null) {
        if (rule.required) return res.status(400).json({ error: `${field} is required` });
        continue;
      }
      if (!rule.test(value)) return res.status(400).json({ error: `${field} ${rule.message}` });
    }
    return next();
  };
}

module.exports = { validateBody, str, int, oneOf, intArray, array };
