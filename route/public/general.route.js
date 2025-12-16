const express = require("express");
const router = express.Router();
const packageJson = require("../../package.json");

router.get("/status", (req, res) => {
  return res.json({ name: packageJson.name, version: packageJson.version });
});

module.exports = router;
