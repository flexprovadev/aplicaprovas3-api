const express = require("express");
const router = express.Router();

router.use(require("./public/auth.route"));
router.use(require("./public/general.route"));

module.exports = router;
