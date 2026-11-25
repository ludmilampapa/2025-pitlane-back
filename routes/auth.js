const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let remoteJWKS = null;
let joseModule = null;

/**
 * Only real, signed-in Supabase users are accepted. This rejects the public `anon` /
 * `service_role` API keys (they are signed with the same secret but have no `sub`
 * and a different `role`), so they can no longer be used as a bearer token.
 */
function hasUserClaims(payload) {
    return (
        !!payload &&
        typeof payload.sub === 'string' &&
        UUID_RE.test(payload.sub) &&
        payload.role === 'authenticated'
    );
}

function verifyLegacySecret(token) {
    if (!JWT_SECRET) throw new Error('JWT_SECRET not configured');
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], audience: 'authenticated' });
}

async function verifyWithJWKS(token) {
    if (!joseModule) joseModule = await import('jose');
    if (!remoteJWKS) {
        remoteJWKS = joseModule.createRemoteJWKSet(
            new URL(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`)
        );
    }
    const { payload } = await joseModule.jwtVerify(token, remoteJWKS, {
        issuer: `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1`,
        audience: 'authenticated',
    });
    return payload;
}

async function authenticateJWT(req, res, next) {
    // Skip authentication for OPTIONS requests (preflight)
    if (req.method === 'OPTIONS') {
        return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado, token requerido' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    let payload = null;

    if (SUPABASE_URL) {
        try {
            payload = await verifyWithJWKS(token);
        } catch (jwksError) {
            // Projects still on the legacy HS256 secret fall back to JWT_SECRET
            try {
                payload = verifyLegacySecret(token);
            } catch (legacyError) {
                console.error('Auth error - Invalid token:', jwksError.message);
            }
        }
    } else {
        try {
            payload = verifyLegacySecret(token);
        } catch (legacyError) {
            console.error('Auth error - Invalid token:', legacyError.message);
        }
    }

    if (!payload || !hasUserClaims(payload)) {
        return res.status(403).json({ error: 'Token inválido' });
    }

    req.user = payload;
    return next();
}

module.exports = authenticateJWT;
module.exports.hasUserClaims = hasUserClaims;
