import Image from "next/image";

import { cn } from "@/lib/utils";

const BRAND_ASSETS = {
  logo: {
    light: "/admin-brand/kastir-logo-light.webp",
    dark: "/admin-brand/kastir-logo-dark.webp",
    width: 513,
    height: 139,
  },
  symbol: {
    light: "/admin-brand/kastir-symbol-light.webp",
    dark: "/admin-brand/kastir-symbol-dark.webp",
    width: 110,
    height: 134,
  },
} as const;

/** Marca compartilhada que acompanha a classe `.dark` sem duplicar o nome acessível. */
export function BrandLogo({
  kind,
  label,
  className,
  priority = false,
}: {
  kind: keyof typeof BRAND_ASSETS;
  label?: string;
  className?: string;
  priority?: boolean;
}) {
  const asset = BRAND_ASSETS[kind];

  return (
    <span
      aria-label={label}
      className={cn("inline-grid shrink-0", className)}
      role={label ? "img" : undefined}
    >
      <Image
        alt=""
        className="col-start-1 row-start-1 size-full object-contain dark:hidden"
        height={asset.height}
        // Um único preload evita baixar as duas variantes ocultas da marca.
        priority={priority}
        src={asset.light}
        width={asset.width}
      />
      <Image
        alt=""
        className="col-start-1 row-start-1 hidden size-full object-contain dark:block"
        height={asset.height}
        src={asset.dark}
        width={asset.width}
      />
    </span>
  );
}
