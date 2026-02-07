import jwt from "jsonwebtoken";
import config from "../config/index.js";

/**
 * JWT Authentication Middleware
 *
 * Verifies the Bearer token and attaches the decoded user to req.user.
 * The token payload should contain:
 *   - sub: user's wallet address
 *   - verified: whether identity is ZK-verified
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Authentication required",
      message: "Provide a Bearer token in the Authorization header",
    });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = {
      address: decoded.sub,
      verified: decoded.verified || false,
      deviceId: decoded.deviceId || null,
    };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }
}

/**
 * Optional auth — sets req.user if token is present, otherwise continues.
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), config.jwtSecret);
    req.user = { address: decoded.sub, verified: decoded.verified || false };
  } catch {
    req.user = null;
  }
  next();
}

/**
 * Generate a JWT for a verified user.
 */
export function generateToken(walletAddress, verified = false, deviceId = null) {
  return jwt.sign(
    { sub: walletAddress, verified, deviceId },
    config.jwtSecret,
    { expiresIn: "24h" }
  );
}
