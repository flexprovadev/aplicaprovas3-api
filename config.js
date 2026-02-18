const normalizeEnv = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value).trim();
};

const env = (key) => normalizeEnv(process.env[key]);

const envOrDefault = (key, defaultValue) => {
  const value = env(key);
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return value;
};

const isTruthy = (value) => {
  const normalized = normalizeEnv(value);
  if (!normalized) {
    return false;
  }
  return ["1", "true", "yes", "y", "on"].includes(normalized.toLowerCase());
};

const databaseName = envOrDefault("DATABASE_NAME", "CHANGE_ME");
const databaseHost = envOrDefault("DATABASE_HOST", "CHANGE_ME");
const databaseUser = envOrDefault("DATABASE_USER", "CHANGE_ME");
const databasePass = envOrDefault("DATABASE_PASS", "CHANGE_ME");
const databaseParams = envOrDefault("DATABASE_PARAMS", "retryWrites=true&w=majority");
const databaseURL = env("DATABASE_URL");
const jwtExpiresIn = envOrDefault("JWT_EXPIRES_IN", "5h");
const s3Region = env("AWS_REGION") || env("AWS_DEFAULT_REGION") || env("S3_REGION");

const database = {
  opts: {},
};

if (databaseURL) {
  database.url = databaseURL;
} else {
  database.url = `mongodb+srv://${databaseUser}:${databasePass}@${databaseHost}/${databaseName}?${databaseParams}`;
}

module.exports = {
  database,
  isDev: isTruthy(env("DEV_MODE")),
  exam: {
    comingSoonMaxDays: envOrDefault("COMING_SOON_MAX_DAYS", 60),
  },
  seed: {
    password: envOrDefault("SEED_PASSWORD", ""),
  },
  s3: {
    prefix: envOrDefault("S3_PREFIX", ""),
    bucket: envOrDefault("S3_BUCKET", "storage.eucorrijo.com"),
    region: s3Region,
    credentials: {
      accessKey: envOrDefault("S3_ACCESS_KEY", ""),
      secretKey: envOrDefault("S3_SECRET_KEY", ""),
    },
  },
  jwt: {
    secret: envOrDefault("JWT_SECRET", "CHANGE_ME"),
    expires_in: jwtExpiresIn,
    cookie_name: envOrDefault("JWT_COOKIE_NAME", "fp_at"),
  },
  timezone: envOrDefault("TIMEZONE", "America/Sao_Paulo"),
  server_port: envOrDefault("PORT", 4000),
};
