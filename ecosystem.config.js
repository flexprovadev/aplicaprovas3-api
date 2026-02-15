const isRenderStaging =
  String(process.env.RENDER_STAGING || "").toLowerCase() === "true";

module.exports = {
  apps: [
    {
      script: "index.js",
      watch: isRenderStaging ? false : ".",
      instances: isRenderStaging ? 1 : "max",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
