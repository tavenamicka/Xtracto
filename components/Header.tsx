import Link from "next/link";
import LogoutButton from "./LogoutButton";

export default function Header() {
  return (
    <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
        <Link href="/" className="font-semibold text-lg">
          Xtracto
        </Link>
        <LogoutButton />
      </div>
    </header>
  );
}
