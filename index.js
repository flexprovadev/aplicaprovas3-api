require("dotenv").config();
require("./auth.strategy");

const { Header } = require("./constants");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const config = require("./config");

const app = express();
app.use(cors({ exposedHeaders: Header.REFRESH_TOKEN }));
app.use(require("helmet")());
app.use(require("compression")());
app.use(require("body-parser").json({ limit: "5mb" }));

console.log("Connecting to MongoDB...");
mongoose.connect(config.database.url, config.database.opts);

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
