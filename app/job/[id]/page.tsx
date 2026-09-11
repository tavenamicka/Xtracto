import Header from "@/components/Header";
import JobStatus from "@/components/JobStatus";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <>
      <Header />
      <main id="main-content" className="flex-1 mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold mb-6">Suivi du job</h1>
        <JobStatus jobId={id} />
      </main>
    </>
  );
}
