import Image from "next/image";
import Link from "next/link";
import logo from "../../public/logo.png";
import { UserMenu } from "./UserMenu";

export function AppHeader({ user }: { user: { email: string } }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <Image
            src={logo}
            alt="Newshog logo"
            width={40}
            height={40}
            className="size-8 rounded-lg object-cover"
            priority
          />
          <span className="text-lg font-semibold tracking-[-0.02em]">Newshog</span>
        </Link>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
