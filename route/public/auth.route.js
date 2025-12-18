const express = require("express");
const passport = require("passport");
const router = express.Router();
const config = require("../../config");
const {
  debugAuth,
  redactEmail,
  tokenFingerprint,
} = require("../../util/logger.util");

const isTruthy = (value) => {
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
};

const parseDurationToMs = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  const match = normalized.match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2] || "s";
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  const multiplier = multipliers[unit];
  if (!multiplier || Number.isNaN(amount)) {
    return null;
  }

  return amount * multiplier;
};

const normalizeSameSite = (value) => {
  const normalized = String(value || "lax").trim().toLowerCase();
  if (normalized === "none") {
    return "none";
  }
  if (normalized === "strict") {
    return "strict";
  }
  return "lax";
};

const buildAuthCookieOptions = ({ includeMaxAge } = {}) => {
  const sameSite = normalizeSameSite(process.env.JWT_COOKIE_SAMESITE);
  const secure =
    isTruthy(process.env.JWT_COOKIE_SECURE) ||
    (process.env.JWT_COOKIE_SECURE === undefined &&
      process.env.NODE_ENV === "production");

  const options = {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  };

  const domain = process.env.JWT_COOKIE_DOMAIN;
  if (domain) {
    options.domain = domain;
  }

  if (includeMaxAge) {
    const maxAge = parseDurationToMs(config.jwt.expires_in);
    if (maxAge) {
      options.maxAge = maxAge;
    }
  }

  return options;
};

router.post("/login", async (req, res, next) => {
  debugAuth("Login route called", {
    email: redactEmail(req.body?.email),
  });
  passport.authenticate("login", { session: false }, (err, user, info) => {
    if (err) {
      console.error("Error during authentication:", err);
      return res.status(500).json({ message: "Erro de autenticação" });
    }
    if (!user) {
      debugAuth("Authentication failed: invalid credentials", {
        email: redactEmail(req.body?.email),
      });
      return res.status(401).json({ message: "Erro de autenticação" });
    }
    const token = user.getJwtToken();
    debugAuth("Authentication successful: token generated", {
      userId: user.id,
      tokenFingerprint: tokenFingerprint(token),
    });

    res.cookie(
      config.jwt.cookie_name,
      token,
      buildAuthCookieOptions({ includeMaxAge: true })
    );
    return res.json({ token });
  })(req, res, next);
});

router.post("/logout", (req, res) => {
  res.clearCookie(
    config.jwt.cookie_name,
    buildAuthCookieOptions({ includeMaxAge: false })
  );
  return res.sendStatus(204);
});

module.exports = router;
