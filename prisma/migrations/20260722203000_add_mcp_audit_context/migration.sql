-- Additive audit metadata for MCP-originated domain mutations.
CREATE TYPE "LogSource" AS ENUM ('PANEL', 'MCP');

ALTER TABLE "LogEntry"
ADD COLUMN "source" "LogSource" NOT NULL DEFAULT 'PANEL',
ADD COLUMN "tool" TEXT,
ADD COLUMN "resource" TEXT,
ADD COLUMN "requestId" TEXT;
