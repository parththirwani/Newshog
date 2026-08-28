import Image from "next/image";
import logo from "../../public/logo.png";
import { ScrollLink } from "./ScrollLink";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Image
            src={logo}
            alt="Newshog logo"
            width={96}
            height={96}
            className="size-10 rounded-[12px] object-cover"
          />
          <span className="text-sm font-medium tracking-[-0.02em]">Newshog</span>
          <span className="label-mono ml-2">Built for people who move first</span>
        </div>
        <div className="flex gap-6 text-sm text-muted-foreground">
          <ScrollLink target="example" className="transition-colors hover:text-foreground">
            Example
          </ScrollLink>
          <ScrollLink target="how" className="transition-colors hover:text-foreground">
            How it works
          </ScrollLink>
          <ScrollLink target="pricing" className="transition-colors hover:text-foreground">
            Pricing
          </ScrollLink>
        </div>
      </div>
    </footer>
  );
}
