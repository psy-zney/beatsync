// See: https://bun.com/docs/guides/ecosystem/pm2
module.exports = {
  name: "beatsync-server", // Name of your application
  cwd: "apps/server",
  script: "dist/index.js", // Bundled entry point
  interpreter: "bun", // Bun interpreter
  env: {
    PATH: `/usr/local/bin:${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add deno & bun to PATH
  },
};
