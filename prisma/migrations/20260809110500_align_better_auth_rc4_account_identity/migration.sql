-- A RC4 reverte o nome físico providerAccountId para accountId, mantendo o
-- issuer como parte obrigatória da identidade externa composta.
DROP INDEX "Account_issuer_providerAccountId_key";
ALTER TABLE "Account" RENAME COLUMN "providerAccountId" TO "accountId";
CREATE UNIQUE INDEX "Account_issuer_accountId_key"
  ON "Account"("issuer", "accountId");
