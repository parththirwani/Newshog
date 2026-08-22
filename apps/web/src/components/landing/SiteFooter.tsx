import Image from "next/image";
import logo from "../../public/logo.png";

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
          <a className="transition-colors hover:text-foreground" href="#example">
            Example
          </a>
          <a className="transition-colors hover:text-foreground" href="#how">
            How it works
          </a>
          <a className="transition-colors hover:text-foreground" href="#cta">
            Get started
          </a>
        </div>
      </div>
    </footer>
  );
}
