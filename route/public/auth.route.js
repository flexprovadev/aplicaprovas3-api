const express = require("express");
const passport = require("passport");
const router = express.Router();
const {
  debugAuth,
  redactEmail,
  tokenFingerprint,
} = require("../../util/logger.util");

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
    return res.json({ token });
  })(req, res, next);
});

module.exports = router;
