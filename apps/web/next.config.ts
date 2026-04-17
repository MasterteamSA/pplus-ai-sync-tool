import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: [
    "@pplus-sync/ai",
    "@pplus-sync/connectors",
    "@pplus-sync/core",
    "@pplus-sync/db",
    "@pplus-sync/formula",
    "@pplus-sync/shared",
  ],
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@anthropic-ai/claude-agent-sdk",
    "postgres",
  ],
};

export default config;
