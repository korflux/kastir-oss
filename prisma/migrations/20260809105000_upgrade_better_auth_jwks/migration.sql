-- Better Auth 1.7 persiste o algoritmo e a curva junto da chave JWT.
ALTER TABLE "jwks"
  ADD COLUMN "alg" TEXT,
  ADD COLUMN "crv" TEXT;
