import { recoverUploads } from "./upload-recovery-run.ts";
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
try {
  await recoverUploads({
    directory: "/recordings",
    person: Number(required("SCRIBA_RECOVERY_PERSON")),
    baseUrl: required("SCRIBA_SWARM_URL"),
    serviceToken: required("SCRIBA_BOT_TOKEN"),
    log: console.log,
  });
} catch (error) {
  console.error("досылка не завершена:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}
