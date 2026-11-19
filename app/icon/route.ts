import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Entrega o WebP aprovado; Next não reconhece WebP como metadata estática. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const icon = await readFile(join(process.cwd(), "app", "icon.webp"));
    return new Response(new Uint8Array(icon), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": "image/webp",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
