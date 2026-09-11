"use client";
import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (!res.ok) {
      setError("Mot de passe incorrect.");
      return;
    }
    router.push(searchParams.get("next") || "/");
    router.refresh();
  }

  return (
    <main id="main-content" className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="card w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Xtracto</h1>
        <p className="text-sm text-[var(--color-muted)] mb-6">
          Accès protégé — entrez le mot de passe partagé.
        </p>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? "password-error" : undefined}
            autoFocus
            required
          />
          {error && (
            <p id="password-error" role="alert" className="text-sm text-[var(--color-danger)] mt-2">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary w-full mt-5" disabled={loading || !password}>
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
