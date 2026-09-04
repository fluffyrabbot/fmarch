#!/usr/bin/env python3
"""Run one heavyweight build command under a machine-wide advisory lock."""

from __future__ import annotations

import fcntl
import json
import os
import pathlib
import signal
import subprocess
import sys
import time


# Distinct exit code returned when an already-running lane is preempted because
# unregistered Cargo/rustc work appeared. Kept in sync with PREEMPTED_EXIT_CODE
# in tools/proof_lane_execution.mjs; the proof sweep supervisor auto-resumes
# once on this code. 75 remains "could not start / busy".
PREEMPTED_EXIT_CODE = 69
PREEMPTION_SIGNAL_PATH = pathlib.Path("target/proof-lanes/preemption-signal.json")


def write_preemption_signal(target_pid: int, competitors: list[str]) -> None:
    """Record a pid-scoped marker so the wrapped runner can label the abort as a
    preemption rather than an ordinary interrupt before its group is killed."""
    try:
        PREEMPTION_SIGNAL_PATH.parent.mkdir(parents=True, exist_ok=True)
        PREEMPTION_SIGNAL_PATH.write_text(
            json.dumps({"pid": target_pid, "competitors": competitors[:8], "at": time.time()}),
            encoding="utf-8",
        )
    except OSError:
        # Best-effort; without the marker the runner records an ordinary
        # interruption, which is safe but simply less precise.
        pass


def ancestor_pids(pid: int, processes: dict[int, tuple[int, str]]) -> set[int]:
    ancestors = {pid}
    while pid in processes and processes[pid][0] > 1:
        pid = processes[pid][0]
        ancestors.add(pid)
    return ancestors


def process_table() -> dict[int, tuple[int, str]]:
    result = subprocess.run(
        ["ps", "-axo", "pid=,ppid=,args="], check=True, text=True, capture_output=True
    )
    processes: dict[int, tuple[int, str]] = {}
    for raw in result.stdout.splitlines():
        fields = raw.strip().split(maxsplit=2)
        if len(fields) == 3:
            processes[int(fields[0])] = (int(fields[1]), fields[2])
    return processes


def descendant_pids(root: int, processes: dict[int, tuple[int, str]]) -> set[int]:
    descendants = {root}
    changed = True
    while changed:
        changed = False
        for pid, (parent, _args) in processes.items():
            if parent in descendants and pid not in descendants:
                descendants.add(pid)
                changed = True
    return descendants


def has_sccache_ancestor(
    pid: int, processes: dict[int, tuple[int, str]]
) -> bool:
    """Return whether rustc was reparented through the long-lived sccache server.

    Cargo's short-lived sccache client remains a descendant of the registered
    lane and is excluded normally. The compiler process used for cache probing
    can instead be spawned by the long-lived sccache server, making it appear
    unrelated even though the registered lane caused it. An unrelated Cargo or
    `sccache rustc` client is still detected before its server-owned child.
    """
    seen: set[int] = set()
    while pid in processes and pid not in seen:
        seen.add(pid)
        parent, args = processes[pid]
        executable = pathlib.Path(args.split(maxsplit=1)[0]).name
        if executable == "sccache":
            return True
        pid = parent
    return False


def process_cwd(pid: int) -> str:
    """Best-effort working directory for an actionable competitor report."""
    try:
        result = subprocess.run(
            ["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
            check=False,
            text=True,
            capture_output=True,
            timeout=2,
        )
    except (OSError, subprocess.TimeoutExpired):
        return "?"
    for line in result.stdout.splitlines():
        if line.startswith("n"):
            return line[1:]
    return "?"


def competing_builds(
    excluded: set[int] | None = None,
    processes: dict[int, tuple[int, str]] | None = None,
) -> list[str]:
    processes = processes or process_table()
    excluded_pids = ancestor_pids(os.getpid(), processes)
    if excluded:
        excluded_pids.update(excluded)
    competitors: list[str] = []
    for pid, (parent, args) in processes.items():
        if pid in excluded_pids:
            continue
        argv = args.split()
        executable_names = {pathlib.Path(value).name for value in argv[:2]}
        if executable_names.isdisjoint({"cargo", "cargo-nextest", "rustc"}):
            continue
        if "rustc" in executable_names and has_sccache_ancestor(pid, processes):
            continue
        parent_args = processes.get(parent, (0, "?"))[1]
        competitors.append(
            f"pid={pid} cwd={process_cwd(pid)} command={args[:240]} "
            f"parent={parent} {parent_args[:160]}"
        )
    return competitors


def report_competitors(competitors: list[str], *, appeared_late: bool) -> None:
    timing = "started while the registered lane was running" if appeared_late else "is already running"
    print(
        f"unregistered Cargo/rustc work {timing}; refusing concurrent heavyweight local builds:",
        file=sys.stderr,
    )
    for competitor in competitors[:8]:
        print(f"  {competitor}", file=sys.stderr)
    if len(competitors) > 8:
        print(f"  ... and {len(competitors) - 8} more process(es)", file=sys.stderr)
    print(
        "wait for it to finish, use an isolated overflow lane, or set HOST_ALLOW_UNREGISTERED_CARGO=1 only after confirming capacity",
        file=sys.stderr,
    )


def terminate_process_group(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def main() -> int:
    args = sys.argv[1:]
    if args[:1] == ["--"]:
        args = args[1:]
    if not args:
        print("usage: with-heavy-build-lock.py -- COMMAND [ARG ...]", file=sys.stderr)
        return 2

    if (
        os.environ.get("HOST_HEAVY_BUILD_LOCK_HELD") == "1"
        or os.environ.get("MESH_HEAVY_BUILD_LOCK_HELD") == "1"
    ):
        return subprocess.run(args, check=False).returncode

    lock_path = pathlib.Path(
        os.environ.get(
            "HOST_HEAVY_BUILD_LOCK_PATH",
            os.environ.get(
                "MESH_HEAVY_BUILD_LOCK_PATH", "/tmp/closure-heavy-rust-build.lock"
            ),
        )
    )
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+", encoding="utf-8") as lock:
        os.set_inheritable(lock.fileno(), False)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(
                f"heavy-build lock is busy: {lock_path}; wait for the active Rust build or use an isolated overflow lane",
                file=sys.stderr,
            )
            return 75

        allow_unregistered = (
            os.environ.get("HOST_ALLOW_UNREGISTERED_CARGO") == "1"
            or os.environ.get("MESH_ALLOW_UNREGISTERED_CARGO") == "1"
        )
        if not allow_unregistered:
            competitors = competing_builds()
            if competitors:
                report_competitors(competitors, appeared_late=False)
                return 75

        env = os.environ.copy()
        env["HOST_HEAVY_BUILD_LOCK_HELD"] = "1"
        env["MESH_HEAVY_BUILD_LOCK_HELD"] = "1"
        process = subprocess.Popen(
            args, env=env, start_new_session=True, close_fds=True
        )

        def stop_on_signal(signum: int, _frame: object) -> None:
            terminate_process_group(process)
            raise SystemExit(128 + signum)

        previous_sigterm = signal.signal(signal.SIGTERM, stop_on_signal)
        try:
            while process.poll() is None:
                time.sleep(1)
                if allow_unregistered:
                    continue
                processes = process_table()
                competitors = competing_builds(
                    descendant_pids(process.pid, processes), processes
                )
                if competitors:
                    report_competitors(competitors, appeared_late=True)
                    write_preemption_signal(process.pid, competitors)
                    terminate_process_group(process)
                    return PREEMPTED_EXIT_CODE
            return process.returncode
        except (KeyboardInterrupt, SystemExit):
            terminate_process_group(process)
            raise
        finally:
            signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == "__main__":
    raise SystemExit(main())
