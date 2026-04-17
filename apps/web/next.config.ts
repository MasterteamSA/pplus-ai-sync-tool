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
};

export default config;
