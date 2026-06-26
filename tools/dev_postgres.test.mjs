import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildConfig,
  databaseUrl,
  defaultDataDir,
  defaultHost,
  defaultPort,
  defaultUser,
  parseArgs,
} from "./dev_postgres.mjs";

test("dev postgres args parse command and path controls", () => {
  assert.deepEqual(parseArgs(["start", "--port", "5545", "--data-dir", "target/pg-alt"]), {
    command: "start",
    port: 5545,
    dataDir: `${process.cwd()}/target/pg-alt`,
  });
  assert.deepEqual(parseArgs(["print-env"]), { command: "print-env" });
  assert.throws(() => parseArgs(["start", "--port", "nope"]), /positive integer/);
  assert.throws(() => parseArgs(["start", "--wat"]), /unknown argument/);
});

test("dev postgres config defaults to the repo-local lane", () => {
  const config = buildConfig({ pgBin: "/pg/bin" }, {});
  assert.equal(config.host, defaultHost);
  assert.equal(config.port, defaultPort);
  assert.equal(config.user, defaultUser);
  assert.equal(config.database, "fmarch");
  assert.equal(config.dataDir, defaultDataDir);
  assert.equal(config.pgBin, "/pg/bin");
  assert.equal(databaseUrl(config), "postgres://fmarch:fmarch@127.0.0.1:5544/fmarch");
});

test("dev postgres config accepts environment overrides", () => {
  const config = buildConfig(
    {},
    {
      PG_BIN: "/env/pg",
      FMARCH_DEV_POSTGRES_HOST: "localhost",
      FMARCH_DEV_POSTGRES_PORT: "6544",
      FMARCH_DEV_POSTGRES_DB: "scratch",
      FMARCH_DEV_POSTGRES_USER: "alice",
      FMARCH_DEV_POSTGRES_PASSWORD: "secret value",
      FMARCH_DEV_POSTGRES_DATA: "/tmp/fmarch-pg",
      FMARCH_DEV_POSTGRES_LOG: "/tmp/fmarch-pg.log",
    },
  );
  assert.equal(config.pgBin, "/env/pg");
  assert.equal(config.host, "localhost");
  assert.equal(config.port, 6544);
  assert.equal(config.database, "scratch");
  assert.equal(config.user, "alice");
  assert.equal(config.dataDir, "/tmp/fmarch-pg");
  assert.equal(config.logPath, "/tmp/fmarch-pg.log");
  assert.equal(databaseUrl(config), "postgres://alice:secret%20value@localhost:6544/scratch");
});
