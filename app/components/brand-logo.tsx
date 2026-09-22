"use client";

import { useEffect, useState } from "react";
import { assetFor } from "@/lib/assets";

interface BrandLogoProps {
  symbol?: string;
  name?: string;
  size?: number;
  className?: string;
  decorative?: boolean;
}

/** Renders a token's real logo from the Robinhood Chain stock-token catalog
 * (baked into lib/assets.ts). Falls back to a branded monogram if a symbol has no
 * logo or the image fails to load. */
export default function BrandLogo({ symbol, name, size = 96, className = "", decorative = false }: BrandLogoProps) {
  const [failed, setFailed] = useState(false);
  const asset = assetFor(symbol);
  const normalizedSymbol = symbol?.trim().toUpperCase();
  // Real company logo from the token's domain (Google's 128px icon service — higher and more
  // consistent resolution than other free sources). An explicit `asset.logo` override wins when
  // set. Robinhood's own CDN only serves a generic placeholder, so it can't be used.
  const logo = asset?.logo ?? (asset?.domain ? `https://www.google.com/s2/favicons?domain=${asset.domain}&sz=128` : undefined);
  const displayLabel = name?.trim() || asset?.name || normalizedSymbol || "Unknown company";
  const fallbackText = normalizedSymbol ?? displayLabel.slice(0, 3).toUpperCase();

  // Reset the error state if the symbol changes (e.g. battle rotation swaps the pair).
  useEffect(() => { setFailed(false); }, [logo]);

  return (
    <span
      className={`brand-logo-frame inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[16px] border border-white/15 bg-white/95 shadow-[0_5px_18px_rgba(0,0,0,.22)] ${className}`}
      style={{ width: size, height: size }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${displayLabel} logo`}
      aria-hidden={decorative ? true : undefined}
      title={`${displayLabel} (${normalizedSymbol ?? "N/A"})`}
    >
      {!logo || failed ? (
        <span
          className="brand-logo-fallback flex h-full w-full items-center justify-center px-1 text-center text-xs font-extrabold tracking-[.02em] text-[#17151a]"
          style={{ backgroundColor: asset?.brandColor ?? "#f4f2f4" }}
          aria-hidden="true"
        >
          <span className="max-w-full overflow-hidden text-ellipsis">{fallbackText}</span>
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt={decorative ? "" : `${displayLabel} logo`}
          width={size}
          height={size}
          draggable={false}
          decoding="async"
          onError={() => setFailed(true)}
          className="brand-logo-image block h-[82%] w-[82%] object-contain"
        />
      )}
    </span>
  );
}
