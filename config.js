const databaseName = process.env.DATABASE_NAME || "CHANGE_ME";
const databaseHost = process.env.DATABASE_HOST || "CHANGE_ME";
const databaseUser = process.env.DATABASE_USER || "CHANGE_ME";
const databasePass = process.env.DATABASE_PASS || "CHANGE_ME";
const databaseParams =
  process.env.DATABASE_PARAMS || "retryWrites=true&w=majority";
const databaseURL = process.env.DATABASE_URL;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "5h";

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
  isDev: process.env.DEV_MODE || false,
  exam: {
    comingSoonMaxDays: process.env.COMING_SOON_MAX_DAYS || 7,
  },
  seed: {
    password: process.env.SEED_PASSWORD || "",
  },
  s3: {
    prefix: process.env.S3_PREFIX || "",
    bucket: process.env.S3_BUCKET || "storage.eucorrijo.com",
    credentials: {
      accessKey: process.env.S3_ACCESS_KEY || "",
      secretKey:
        process.env.S3_SECRET_KEY || "",
    },
  },
  jwt: {
    secret: process.env.JWT_SECRET || "CHANGE_ME",
    expires_in: jwtExpiresIn,
    cookie_name: process.env.JWT_COOKIE_NAME || "fp_at",
  },
  timezone: process.env.TIMEZONE || "America/Sao_Paulo",
  server_port: process.env.PORT || 4000,
};
