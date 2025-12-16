const express = require("express");
const passport = require("passport");
const router = express.Router();

router.post("/login", async (req, res, next) => {
  console.log('Login route called with body:', req.body);
  passport.authenticate("login", { session: false }, (err, user, info) => {
    if (err) {
      console.error('Error during authentication:', err);
      return res.status(500).json({ message: "Erro de autenticação" });
    }
    if (!user) {
      console.warn('Authentication failed, user not found.');
      return res.status(401).json({ message: "Erro de autenticação" });
    }
    const token = user.getJwtToken();
    console.log('Authentication successful, token generated:', token);
    return res.json({ token });
  })(req, res, next);
});

module.exports = router;
