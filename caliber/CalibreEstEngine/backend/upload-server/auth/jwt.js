import jwt from 'jsonwebtoken';

const DEV_JWT_SECRET = 'calibre-dev-insecure-secret-change-me';
const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

// Fail startup outright in production rather than silently signing every
// session with a secret that is committed in this file's own source —
// local development is unaffected: this only triggers when NODE_ENV is
// explicitly set to 'production' and no real secret was configured.
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEV_JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is missing or still the insecure development default in a production ' +
    'environment (NODE_ENV=production). Set a real JWT_SECRET before starting this service.'
  );
}

if (!process.env.JWT_SECRET) {
  console.warn(
    '\n⚠️  JWT_SECRET is not set — using an insecure built-in dev default. ' +
    'Set JWT_SECRET in backend/upload-server/.env before any real deployment.\n'
  );
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, department: user.department, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
