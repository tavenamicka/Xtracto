import Header from "@/components/Header";
import JobForm from "@/components/JobForm";

export default function HomePage() {
  return (
    <>
      <Header />
      <main id="main-content" className="flex-1 mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold mb-1">Extraire depuis YouTube</h1>
        <p className="text-[var(--color-muted)] mb-8">
          Colle un lien, choisis ce que tu veux récupérer, on s&apos;occupe du reste.
        </p>
        <JobForm />
      </main>
    </>
  );
}
