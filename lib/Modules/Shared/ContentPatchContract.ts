/**
 * Constantes do contrato de entrada do patch e do hash de conteúdo (phase-5),
 * fonte única para os schemas de páginas e scripts, as tools MCP e a guarda de
 * versão.
 *
 * Por que é um arquivo à parte de `ContentPatch.ts`: aqui só há valores puros,
 * sem `node:crypto`. `Pages/Schema.ts` e `CustomCode/Schema.ts` são importados
 * por componentes de cliente (`ColorPicker`, por exemplo) e entram no bundle do
 * navegador, onde `node:crypto` não existe; `ContentPatch.ts` (hash e aplicação
 * do patch) importa `node:crypto` e por isso só pode ser carregado no servidor.
 * Quem precisa só do padrão ou do teto importa deste módulo; `ContentPatch.ts`
 * reexporta `CONTENT_SHA256_PATTERN` para os consumidores de servidor.
 *
 * Não importar nada pesado aqui: o arquivo precisa continuar seguro para o
 * cliente.
 */

/**
 * 64 caracteres hexadecimais em qualquer caixa. A borda aceita maiúsculas e a
 * guarda de versão compara em minúsculas; a saída (`contentSha256`) é sempre
 * minúscula.
 */
export const CONTENT_SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Teto de operações `{old, new}` por patch de conteúdo (decisão 6 da spec da
 * phase-5). Vale igual para páginas e scripts: as tools MCP o aplicam na borda
 * e os serviços o repetem para não depender de quem chama.
 */
export const CONTENT_PATCH_MAX_OPERATIONS = 50;
