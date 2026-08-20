import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertLocalProofEndpoint,
  assertDisposableDatabaseName,
  applyUnixSocketDirectories,
  buildConfig,
  databaseUrl,
  defaultDataDir,
  defaultHost,
  defaultPort,
  defaultUser,
  devPostgresListenerState,
  disposableDatabaseConfig,
  parseArgs,
  pgCtlStartOptions,
  quotePostgresArg,
  socketDirectory,
  unixSocketDirectoriesSetting,
} from "./dev_postgres.mjs";

test("dev postgres args parse command and path controls", () => {
  assert.deepEqual(parseArgs(["start", "--port", "5545", "--data-dir", "target/pg-alt"]), {
    command: "start",
    port: 5545,
    dataDir: `${process.cwd()}/target/pg-alt`,
  });
  assert.deepEqual(
    parseArgs(["start", "--socket-dir", "target/pg-alt/sockets"]),
    {
      command: "start",
      socketDir: `${process.cwd()}/target/pg-alt/sockets`,
    },
  );
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
  assert.equal(config.socketDir, socketDirectory(defaultDataDir));
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
      FMARCH_DEV_POSTGRES_SOCKET_DIR: "/tmp/fmarch-pg-sockets",
      FMARCH_DEV_POSTGRES_LOG: "/tmp/fmarch-pg.log",
    },
  );
  assert.equal(config.pgBin, "/env/pg");
  assert.equal(config.host, "localhost");
  assert.equal(config.port, 6544);
  assert.equal(config.database, "scratch");
  assert.equal(config.user, "alice");
  assert.equal(config.dataDir, "/tmp/fmarch-pg");
  assert.equal(config.socketDir, "/tmp/fmarch-pg-sockets");
  assert.equal(config.logPath, "/tmp/fmarch-pg.log");
  assert.equal(databaseUrl(config), "postgres://alice:secret%20value@localhost:6544/scratch");
});

test("proof databases are generated, isolated names rooted in the repo-local cluster", () => {
  const config = buildConfig({ pgBin: "/pg/bin" }, {});
  const disposable = disposableDatabaseConfig(config, "fmarch_proof_run42_commands_pg");
  assert.equal(disposable.database, "fmarch_proof_run42_commands_pg");
  assert.equal(
    databaseUrl(disposable),
    "postgres://fmarch:fmarch@127.0.0.1:5544/fmarch_proof_run42_commands_pg",
  );
  assert.doesNotThrow(() => assertDisposableDatabaseName("fmarch_proof_run42_commands_pg"));
  assert.throws(() => assertDisposableDatabaseName("fmarch"), /generated fmarch_proof/);
  assert.throws(() => assertDisposableDatabaseName("fmarch_proof_bad-name"), /generated fmarch_proof/);
  assert.doesNotThrow(() => assertLocalProofEndpoint(config));
  assert.throws(
    () => assertLocalProofEndpoint({ ...config, host: "db.example.test" }),
    /must be loopback/,
  );
});

test("dev postgres keeps Unix sockets beside PGDATA, not in /run/postgresql", () => {
  assert.equal(socketDirectory("/tmp/fmarch-pg/data"), "/tmp/fmarch-pg/sockets");
  assert.equal(
    socketDirectory("/home/fluffyr/build/fmarch/target/local-postgres/data"),
    "/home/fluffyr/build/fmarch/target/local-postgres/sockets",
  );
  assert.match(quotePostgresArg("/tmp/pg sockets"), /^'\/tmp\/pg sockets'$/);
  assert.equal(
    pgCtlStartOptions({
      host: "127.0.0.1",
      port: 5544,
      socketDir: "/tmp/fmarch-pg/sockets",
    }),
    "-p 5544 -h 127.0.0.1 -k /tmp/fmarch-pg/sockets",
  );
  assert.equal(
    unixSocketDirectoriesSetting("/tmp/fmarch-pg/sockets"),
    "unix_socket_directories = '/tmp/fmarch-pg/sockets'",
  );
  assert.match(
    applyUnixSocketDirectories("# cluster\n", "/tmp/fmarch-pg/sockets"),
    /unix_socket_directories = '\/tmp\/fmarch-pg\/sockets'\n$/,
  );
  assert.equal(
    applyUnixSocketDirectories("unix_socket_directories = '/run/postgresql'\n", "/tmp/s"),
    "unix_socket_directories = '/tmp/s'\n",
  );
});

test("dev postgres distinguishes its server from an occupied port", () => {
  assert.equal(
    devPostgresListenerState({
      initialized: true,
      ownedServerRunning: true,
      acceptingConnections: true,
      portOpen: true,
    }),
    "ready",
  );
  assert.equal(
    devPostgresListenerState({
      initialized: true,
      ownedServerRunning: true,
      acceptingConnections: false,
      portOpen: true,
    }),
    "starting",
  );
  assert.equal(
    devPostgresListenerState({
      initialized: true,
      ownedServerRunning: false,
      acceptingConnections: true,
      portOpen: true,
    }),
    "occupied",
  );
  assert.equal(
    devPostgresListenerState({
      initialized: true,
      ownedServerRunning: false,
      acceptingConnections: false,
      portOpen: false,
    }),
    "stopped",
  );
  assert.equal(
    devPostgresListenerState({
      initialized: false,
      ownedServerRunning: false,
      acceptingConnections: false,
      portOpen: false,
    }),
    "uninitialized",
  );
});
