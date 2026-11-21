
import {
  checkpointer,
  closePostgres,
  verifyPostgres,
} from "../src/db/langgraph-checkpointer.js";

async function main() {
  console.log("[RyanAI] Checking PostgreSQL...");

  const connected = await verifyPostgres();

  if (!connected) {
    throw new Error("PostgreSQL connectivity failed");
  }

  console.log("[RyanAI] PostgreSQL connection verified.");

  // Explicit initialization operation.
  // Run against staging first.
  await checkpointer.setup();

  console.log("[RyanAI] LangGraph checkpointer initialized.");
}

main()
  .catch((error) => {
    console.error("[RyanAI] Checkpointer initialization failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgres();
  });
