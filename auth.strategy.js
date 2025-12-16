const config = require("./config");
const passport = require("passport");
const passportJWT = require("passport-jwt");
const User = require("./model/user");
const LocalStrategy = require("passport-local").Strategy;
const JWTStrategy = passportJWT.Strategy;
const ExtractJWT = passportJWT.ExtractJwt;

const localStrategyOpts = {
  usernameField: "email",
  passwordField: "password",
};

const localStrategyCallback = async (username, password, callback) => {
  console.log(`Attempting to authenticate user: ${username}`);
  const user = await User.findOne({
    email: username,
    enabled: true,
  }).populate("roles");
  if (user) {
    console.log(`User found: ${username}`);
    const isValid = await user.isPasswordValid(password);
    console.log(`Password valid: ${isValid}`);
    if (isValid) {
      return callback(null, user);
    }
  }
  console.log(`Authentication failed for user: ${username}`);
  return callback(null, false);
};

passport.use(
  "login",
  new LocalStrategy(localStrategyOpts, localStrategyCallback)
);

const jwtStrategyOpts = {
  jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
  secretOrKey: config.jwt.secret,
};

const jwtStrategyCallback = async (jwtPayload, callback) => {
  console.log(`Verifying JWT for user ID: ${jwtPayload.id}`);
  const user = await User.findOne({ _id: jwtPayload.id }).populate("roles");
  if (user) {
    console.log(`JWT verified for user: ${user.email}`);
    return callback(null, user);
  }
  console.log(`JWT verification failed for user ID: ${jwtPayload.id}`);
  return callback(null, false);
};

passport.use("jwt", new JWTStrategy(jwtStrategyOpts, jwtStrategyCallback));

