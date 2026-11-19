-- Better Auth RC4 separa descoberta e client credentials dos metadados legados.
ALTER TABLE "oauthClient"
  ADD COLUMN "clientDiscoveryId" TEXT,
  ADD COLUMN "clientCredentialsScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "applicationType" TEXT,
  DROP COLUMN "public",
  DROP COLUMN "type";

-- Um vínculo cliente-resource é um conjunto; remove duplicatas exatas antes
-- de tornar a unicidade uma invariável do banco exigida pelo provider.
DELETE FROM "oauthClientResource" a
USING "oauthClientResource" b
WHERE a."clientId" = b."clientId"
  AND a."resourceId" = b."resourceId"
  AND a."id" > b."id";

CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_key"
  ON "oauthClientResource"("clientId", "resourceId");
