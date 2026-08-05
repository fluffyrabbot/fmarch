import { spawn } from "node:child_process";

/** Run the explicit schema owner before starting any local API process. */
export async function runFmarchMigrations({ cwd, databaseUrl, env = process.env }) {
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required by the fmarch migrator");
  }
  await new Promise((resolve, reject) => {
    const child = spawn(
      "cargo",
      ["run", "--quiet", "-p", "server", "--bin", "fmarch-migrate"],
      {
        cwd,
        env: { ...env, DATABASE_URL: databaseUrl },
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`fmarch-migrate exited code=${code} signal=${signal ?? "none"}`));
    });
  });
}
