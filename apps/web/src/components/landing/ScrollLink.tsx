"use client";

import { useCallback } from "react";

// Same-page smooth scroll without a hash in the URL. Keeps an <a href> with
// the real anchor (a11y: keyboard focus, middle-click, no-JS fallback) but
// intercepts the default jump so the address bar never gets a `#section`.
// Alignment is handled by `scroll-mt-*` (scroll-margin-top) on the target
// section, which matches the sticky header height — scrollIntoView respects
// scroll-margin-top, so the section lands fully below the header instead of
// being overlapped by it.
export function ScrollLink({
  target,
  className,
  children,
}: {
  target: string;
  className?: string;
  children: React.ReactNode;
}) {
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [target],
  );

  return (
    <a href={`#${target}`} onClick={onClick} className={className}>
      {children}
    </a>
  );
}