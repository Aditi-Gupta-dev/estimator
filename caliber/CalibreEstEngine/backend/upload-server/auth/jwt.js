import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'calibre-dev-insecure-secret-change-me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

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
