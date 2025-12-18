const config = require("./config");
const passport = require("passport");
const passportJWT = require("passport-jwt");
const User = require("./model/user");
const LocalStrategy = require("passport-local").Strategy;
const JWTStrategy = passportJWT.Strategy;
const ExtractJWT = passportJWT.ExtractJwt;
const { debugAuth, redactEmail } = require("./util/logger.util");

const localStrategyOpts = {
  usernameField: "email",
  passwordField: "password",
};

const localStrategyCallback = async (username, password, callback) => {
  debugAuth("Attempting to authenticate user", { email: redactEmail(username) });
  const user = await User.findOne({
    email: username,
    enabled: true,
  }).populate("roles");
  if (user) {
    const isValid = await user.isPasswordValid(password);
    if (isValid) {
      debugAuth("Authentication successful", { email: redactEmail(username) });
      return callback(null, user);
    }
  }
  debugAuth("Authentication failed", { email: redactEmail(username) });
  return callback(null, false);
};

passport.use(
  "login",
  new LocalStrategy(localStrategyOpts, localStrategyCallback)
);

const parseCookieHeader = (cookieHeader) => {
  if (!cookieHeader || typeof cookieHeader !== "string") {
    return {};
  }

  return cookieHeader.split(";").reduce((acc, rawCookie) => {
    const trimmed = rawCookie.trim();
    if (!trimmed) {
      return acc;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return acc;
    }
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    if (!name) {
      return acc;
    }

    try {
      acc[name] = decodeURIComponent(value);
    } catch {
      acc[name] = value;
    }
    return acc;
  }, {});
};

const cookieExtractor = (req) => {
  const cookieHeader = req?.headers?.cookie;
  if (!cookieHeader) {
    return null;
  }

  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[config.jwt.cookie_name];
  return token || null;
};

const jwtStrategyOpts = {
  jwtFromRequest: ExtractJWT.fromExtractors([
    cookieExtractor,
    ExtractJWT.fromAuthHeaderAsBearerToken(),
  ]),
  secretOrKey: config.jwt.secret,
};

if (config.jwt.expires_in) {
  jwtStrategyOpts.jsonWebTokenOptions = { maxAge: config.jwt.expires_in };
}

const jwtStrategyCallback = async (jwtPayload, callback) => {
  debugAuth("Verifying JWT", { userId: jwtPayload.id });
  const user = await User.findOne({ _id: jwtPayload.id }).populate("roles");
  if (user) {
    debugAuth("JWT verified", { userId: user.id, email: redactEmail(user.email) });
    return callback(null, user);
  }
  debugAuth("JWT verification failed", { userId: jwtPayload.id });
  return callback(null, false);
};

passport.use("jwt", new JWTStrategy(jwtStrategyOpts, jwtStrategyCallback));
