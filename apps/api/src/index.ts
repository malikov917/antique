import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });
  await app.listen({ host: "0.0.0.0", port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

