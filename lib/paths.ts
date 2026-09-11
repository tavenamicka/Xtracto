import path from "node:path";

const OUTPUT_ROOT = process.env.OUTPUT_ROOT || path.join(process.cwd(), "worker", "output");

export function outputDir(jobId: string): string {
  return path.join(OUTPUT_ROOT, jobId);
}
