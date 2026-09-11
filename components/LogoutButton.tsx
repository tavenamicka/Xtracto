"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={handleLogout} className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
      Se déconnecter
    </button>
  );
}
