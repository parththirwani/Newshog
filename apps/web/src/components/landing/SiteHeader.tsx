export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-[7px] bg-foreground font-mono text-[11px] font-medium text-primary-foreground">
            N
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.02em]">Newshog</span>
        </a>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a className="transition-colors hover:text-foreground" href="#example">
            Example
          </a>
          <a className="transition-colors hover:text-foreground" href="#how">
            How it works
          </a>
          <a className="transition-colors hover:text-foreground" href="#cta">
            Pricing
          </a>
        </nav>
        <a
          href="#cta"
          className="rounded-full border border-border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
        >
          Score a story
        </a>
      </div>
    </header>
  );
}
