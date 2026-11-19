import packageJson from "@/package.json";

/** Identidade do servidor MCP — version sempre espelha package.json. */
export const MCP_SERVER_INFO = {
  name: "kastir-cms",
  version: packageJson.version,
} as const;
