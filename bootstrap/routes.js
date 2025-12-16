const passport = require("passport");
const { refreshToken } = require("../middleware");

function initialize(app) {
  const authentication = passport.authenticate("jwt", { session: false });

  app.use("/", refreshToken, require("../route/public.route"));
  app.use(
    "/",
    [authentication, refreshToken],
    require("../route/protected.route")
  );

  app.use((req, res, next) => {
    return res.status(404).json({ message: "Page Not Found" });
  });

  app.use((err, req, res, next) => {
    console.error(err.stack);
    return res.status(500).json({ message: "Internal Server Error" });
  });
}

module.exports = { initialize };
