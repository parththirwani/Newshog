import Image from "next/image";
import logo from "../../public/logo.png";
import { AuthButton } from "./AuthButton";
import { ScrollLink } from "./ScrollLink";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-auto max-w-6xl items-center justify-between px-5 py-4">
        <ScrollLink
          target="top"
          className="flex items-center gap-2.5 transition-colors hover:text-foreground"
        >
          <Image
            src={logo}
            alt="Newshog logo"
            width={40}
            height={40}
            className="size-10 rounded-xl object-cover"
            priority
          />
          <span className="text-xl font-semibold tracking-[-0.02em]">Newshog</span>
        </ScrollLink>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <ScrollLink target="example" className="transition-colors hover:text-foreground">
            Example
          </ScrollLink>
          <ScrollLink target="how" className="transition-colors hover:text-foreground">
            How it works
          </ScrollLink>
          <ScrollLink target="pricing" className="transition-colors hover:text-foreground">
            Pricing
          </ScrollLink>
        </nav>
        <div className="flex items-center gap-2">
          <AuthButton />
          <ScrollLink
            target="cta"
            className="rounded-full border border-border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
          >
            Score a story
          </ScrollLink>
        </div>
      </div>
    </header>
  );
}