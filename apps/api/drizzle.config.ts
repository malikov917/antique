import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/auth/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.API_DB_PATH ?? "./data/antique.sqlite"
  },
  verbose: true,
  strict: true
});
