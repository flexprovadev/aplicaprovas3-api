const passport = require("passport");

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

function initialize(app) {
  const authentication = passport.authenticate("jwt", { session: false });

  app.use("/", require("../route/public.route"));
  app.use("/", authentication, require("../route/protected.route"));

  app.use((req, res, next) => {
    return res.status(404).json({ message: "Page Not Found" });
  });

  app.use((err, req, res, next) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: "Arquivo excede o limite máximo de 10 MB.",
        code: "FILE_TOO_LARGE",
        maxSizeBytes: MAX_UPLOAD_SIZE_BYTES,
      });
    }

    console.error(err.stack || err);
    return res.status(500).json({ message: "Internal Server Error" });
  });
}

module.exports = { initialize };
