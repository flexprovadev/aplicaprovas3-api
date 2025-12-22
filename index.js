require("dotenv").config();
require("./auth.strategy");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");
const config = require("./config");

const parseOrigins = (value) => {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parsedOrigins = parseOrigins(process.env.CORS_ORIGINS);
const allowedOrigins =
  parsedOrigins.length > 0 ? parsedOrigins : ["http://localhost:3000"];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      // Allow requests with no origin (mobile apps, curl, same-origin)
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  optionsSuccessStatus: 204,
};

const app = express();
app.use(cors(corsOptions));
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(require("compression")());
app.use(express.json({ limit: "5mb" }));

console.log("Connecting to MongoDB...");
mongoose
  .connect(config.database.url, config.database.opts)
  .catch((error) => {
    console.error(`Error connecting to database: ${error}`);
  });

const databaseConnection = mongoose.connection;

databaseConnection.on("error", (error) => {
  console.log(`Error connecting to database: ${error}`);
});

databaseConnection.on("open", () => {
  console.log("Connected to MongoDB. Starting server...");
  app.listen(config.server_port, () => {
    console.log(`Server running on port ${config.server_port}`);
    require("./bootstrap/database").initialize();
    require("./bootstrap/routes").initialize(app);
  });
});

// require("./util/grade.util.test");
