-- Better Auth 1.7 identifica contas por issuer + subject e preserva o subject existente.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Account" WHERE "providerId" <> 'credential') THEN
    RAISE EXCEPTION 'Better Auth 1.7 migration requires explicit issuer mapping for non-credential accounts';
  END IF;
END $$;

DROP INDEX "Account_providerId_accountId_key";
ALTER TABLE "Account" RENAME COLUMN "accountId" TO "providerAccountId";
ALTER TABLE "Account" ADD COLUMN "issuer" TEXT;
UPDATE "Account" SET "issuer" = 'local:credential';
ALTER TABLE "Account" ALTER COLUMN "issuer" SET NOT NULL;
CREATE UNIQUE INDEX "Account_issuer_providerAccountId_key"
  ON "Account"("issuer", "providerAccountId");

-- Campos aditivos do provider 1.7: DPoP, logout e chaves de clientes.
ALTER TABLE "oauthClient"
  ADD COLUMN "backchannelLogoutUri" TEXT,
  ADD COLUMN "backchannelLogoutSessionRequired" BOOLEAN,
  ADD COLUMN "jwks" TEXT,
  ADD COLUMN "jwksUri" TEXT,
  ADD COLUMN "dpopBoundAccessTokens" BOOLEAN DEFAULT false;

-- Resources persistidos tornam o audience parte do grant OAuth original.
CREATE TABLE "oauthResource" (
  "id" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "accessTokenTtl" INTEGER,
  "refreshTokenTtl" INTEGER,
  "signingAlgorithm" TEXT,
  "signingKeyId" TEXT,
  "allowedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "customClaims" JSONB,
  "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
  "disabled" BOOLEAN DEFAULT false,
  "createdAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3),
  "policyVersion" INTEGER DEFAULT 1,
  "metadata" JSONB,
  CONSTRAINT "oauthResource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauthResource_identifier_key"
  ON "oauthResource"("identifier");

CREATE TABLE "oauthClientResource" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3),
  CONSTRAINT "oauthClientResource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "oauthClientResource_clientId_idx"
  ON "oauthClientResource"("clientId");
CREATE INDEX "oauthClientResource_resourceId_idx"
  ON "oauthClientResource"("resourceId");
ALTER TABLE "oauthClientResource"
  ADD CONSTRAINT "oauthClientResource_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauthClientResource"
  ADD CONSTRAINT "oauthClientResource_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "oauthResource"("identifier")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- O grant e suas rotações carregam resource, replay e confirmação até a revogação.
ALTER TABLE "oauthRefreshToken"
  ADD COLUMN "authorizationCodeId" TEXT,
  ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "requestedUserInfoClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "rotatedAt" TIMESTAMP(3),
  ADD COLUMN "rotationReplayResponse" TEXT,
  ADD COLUMN "rotationReplayExpiresAt" TIMESTAMP(3),
  ADD COLUMN "confirmation" JSONB;
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx"
  ON "oauthRefreshToken"("authorizationCodeId");

ALTER TABLE "oauthAccessToken"
  ADD COLUMN "authorizationCodeId" TEXT,
  ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "requestedUserInfoClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "revoked" TIMESTAMP(3),
  ADD COLUMN "confirmation" JSONB;
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx"
  ON "oauthAccessToken"("authorizationCodeId");

ALTER TABLE "oauthConsent"
  ADD COLUMN "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "requestedUserInfoClaims" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- JTIs de client assertions impedem replay de autenticação privada.
CREATE TABLE "oauthClientAssertion" (
  "id" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "oauthClientAssertion_pkey" PRIMARY KEY ("id")
);
