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

/**
 * Normaliza o valor de SameSite para cookies.
 * 
 * IMPORTANTE para iOS/Safari:
 * - SameSite=None REQUER Secure=true e HTTPS
 * - Safari iOS bloqueia cookies third-party por padrão
 * - Para cross-origin, use SameSite=None com Secure=true
 * - Para same-origin, SameSite=Lax ou Strict funciona melhor
 * 
 * @param {string} value - Valor de SameSite ('lax', 'strict', 'none')
 * @returns {string} Valor normalizado
 */
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

/**
 * Constrói as opções de cookie para autenticação JWT.
 * 
 * CONFIGURAÇÃO PARA iOS/Safari:
 * 
 * O Safari iOS tem políticas muito restritivas para cookies:
 * 1. Cookies third-party são bloqueados por padrão
 * 2. SameSite=None REQUER Secure=true e conexão HTTPS
 * 3. Cookies podem não funcionar em contexto cross-origin
 * 
 * RECOMENDAÇÕES:
 * - Para desenvolvimento local: SameSite=Lax, Secure=false (HTTP)
 * - Para produção cross-origin: SameSite=None, Secure=true (HTTPS obrigatório)
 * - Para produção same-origin: SameSite=Lax ou Strict, Secure=true
 * 
 * VARIÁVEIS DE AMBIENTE:
 * - JWT_COOKIE_SAMESITE: 'lax' | 'strict' | 'none' (padrão: 'lax')
 * - JWT_COOKIE_SECURE: 'true' | 'false' (padrão: true em produção)
 * - JWT_COOKIE_DOMAIN: domínio do cookie (opcional)
 * 
 * NOTA: O frontend também usa header Authorization como fallback para iOS,
 * então mesmo que cookies falhem, a autenticação ainda funciona.
 * 
 * @param {Object} options - Opções de configuração
 * @param {boolean} options.includeMaxAge - Se deve incluir maxAge no cookie
 * @returns {Object} Opções de cookie configuradas
 */
const buildAuthCookieOptions = ({ includeMaxAge } = {}) => {
  const sameSite = normalizeSameSite(process.env.JWT_COOKIE_SAMESITE);
  const secure =
    isTruthy(process.env.JWT_COOKIE_SECURE) ||
    (process.env.JWT_COOKIE_SECURE === undefined &&
      process.env.NODE_ENV === "production");

  // Validação: SameSite=None requer Secure=true
  if (sameSite === "none" && !secure) {
    console.warn(
      "⚠️  AVISO: SameSite=None requer Secure=true. " +
      "Cookies podem não funcionar corretamente, especialmente no iOS/Safari. " +
      "Configure JWT_COOKIE_SECURE=true ou use HTTPS."
    );
  }

  // Validação: SameSite=None em desenvolvimento pode causar problemas
  if (sameSite === "none" && process.env.NODE_ENV !== "production") {
    console.warn(
      "⚠️  AVISO: SameSite=None em desenvolvimento pode causar problemas. " +
      "Considere usar SameSite=Lax para desenvolvimento local."
    );
  }

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

  // Log de diagnóstico em desenvolvimento
  if (process.env.NODE_ENV !== "production") {
    debugAuth("Cookie options configured", {
      sameSite,
      secure,
      domain: domain || "not set",
      hasMaxAge: !!options.maxAge,
    });
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
