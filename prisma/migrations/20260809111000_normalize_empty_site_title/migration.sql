-- Normaliza instalações antigas criadas antes de o bootstrap adotar o mesmo
-- requisito de título não vazio aplicado pela API de Settings.
UPDATE "SiteSettings"
SET "siteTitle" = 'Kastir'
WHERE btrim("siteTitle") = '';
