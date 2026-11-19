/**
 * Asterisco vermelho de campo obrigatório (Figma).
 * Uso: <label>Name <RequiredMark /></label>
 * O visual é o "*", o leitor de tela ouve "required" via sr-only.
 */
export function RequiredMark({
  label = "required",
}: {
  /** Texto anunciado ao leitor de tela (i18n do consumidor). */
  label?: string;
}) {
  return (
    <span
      className="text-destructive ms-0.5 inline-flex font-medium"
      data-testid="required-mark"
    >
      <span aria-hidden="true">*</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
