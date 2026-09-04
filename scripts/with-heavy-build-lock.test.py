#!/usr/bin/env python3
"""Deterministic contracts for the host-wide heavyweight build lock."""

from __future__ import annotations

import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).with_name("with-heavy-build-lock.py")
SPEC = importlib.util.spec_from_file_location("with_heavy_build_lock", SCRIPT)
assert SPEC and SPEC.loader
LOCK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LOCK)


def unregistered_environment(**updates: str) -> dict[str, str]:
    env = os.environ.copy()
    env.pop("HOST_HEAVY_BUILD_LOCK_HELD", None)
    env.pop("MESH_HEAVY_BUILD_LOCK_HELD", None)
    env.update(updates)
    return env


class FakeProcess:
    def __init__(self) -> None:
        self.pid = 4242
        self.returncode: int | None = None

    def poll(self) -> int | None:
        return self.returncode


class HeavyBuildLockTests(unittest.TestCase):
    def test_acquires_lock_and_marks_registered_child(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lock_path = pathlib.Path(directory, "host.lock")
            env = unregistered_environment(
                HOST_HEAVY_BUILD_LOCK_PATH=str(lock_path),
                HOST_ALLOW_UNREGISTERED_CARGO="1",
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--",
                    sys.executable,
                    "-c",
                    (
                        "import os; "
                        "assert os.environ['HOST_HEAVY_BUILD_LOCK_HELD'] == '1'; "
                        "assert os.environ['MESH_HEAVY_BUILD_LOCK_HELD'] == '1'"
                    ),
                ],
                env=env,
                check=False,
                timeout=10,
            )
            self.assertEqual(result.returncode, 0)
            self.assertTrue(lock_path.exists())

    def test_nested_registered_invocation_is_reentrant(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env = unregistered_environment(
                HOST_HEAVY_BUILD_LOCK_PATH=str(pathlib.Path(directory, "host.lock")),
                HOST_ALLOW_UNREGISTERED_CARGO="1",
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--",
                    sys.executable,
                    str(SCRIPT),
                    "--",
                    sys.executable,
                    "-c",
                    "pass",
                ],
                env=env,
                check=False,
                timeout=10,
            )
            self.assertEqual(result.returncode, 0)

    def test_competing_cargo_is_reported_but_registered_descendants_are_excluded(self) -> None:
        processes = {
            10: (1, "/usr/bin/cargo test -p foreign"),
            20: (10, "/usr/bin/rustc --crate-name foreign"),
            30: (1, "/usr/bin/python registered"),
            31: (30, "/usr/bin/cargo test -p fmarch"),
        }
        with mock.patch.object(LOCK.os, "getpid", return_value=30), mock.patch.object(
            LOCK, "process_cwd", return_value="/workspace"
        ):
            competitors = LOCK.competing_builds({31}, processes)
        self.assertEqual(len(competitors), 2)
        self.assertTrue(any("pid=10" in item for item in competitors))
        self.assertTrue(any("pid=20" in item for item in competitors))
        self.assertFalse(any("pid=31" in item for item in competitors))

    def test_late_competitor_terminates_registered_lane(self) -> None:
        process = FakeProcess()
        preemptions: list[tuple[int, list[str]]] = []

        def terminate(candidate: FakeProcess) -> None:
            self.assertIs(candidate, process)
            candidate.returncode = -15

        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            sys, "argv", [str(SCRIPT), "--", "registered-command"]
        ), mock.patch.dict(
            os.environ,
            {
                "HOST_HEAVY_BUILD_LOCK_PATH": str(pathlib.Path(directory, "host.lock")),
                "HOST_HEAVY_BUILD_LOCK_HELD": "0",
                "MESH_HEAVY_BUILD_LOCK_HELD": "0",
            },
            clear=False,
        ), mock.patch.object(
            LOCK, "competing_builds", side_effect=[[], ["pid=99 command=cargo test"]]
        ), mock.patch.object(
            LOCK.subprocess, "Popen", return_value=process
        ), mock.patch.object(
            LOCK, "process_table", return_value={}
        ), mock.patch.object(
            LOCK, "descendant_pids", return_value={process.pid}
        ), mock.patch.object(
            LOCK, "terminate_process_group", side_effect=terminate
        ), mock.patch.object(
            LOCK,
            "write_preemption_signal",
            side_effect=lambda pid, competitors: preemptions.append((pid, list(competitors))),
        ), mock.patch.object(
            LOCK.time, "sleep", return_value=None
        ), mock.patch.object(
            LOCK.signal, "signal", return_value=LOCK.signal.SIG_DFL
        ):
            self.assertEqual(LOCK.main(), LOCK.PREEMPTED_EXIT_CODE)
            self.assertEqual(process.returncode, -15)
            self.assertEqual(preemptions, [(process.pid, ["pid=99 command=cargo test"])])

    def test_signal_termination_escalates_from_term_to_kill(self) -> None:
        process = FakeProcess()
        calls: list[int] = []

        def killpg(_pid: int, signal_number: int) -> None:
            calls.append(signal_number)

        def wait(timeout: int | None = None) -> int:
            if timeout is not None:
                raise subprocess.TimeoutExpired("child", timeout)
            process.returncode = -9
            return process.returncode

        process.wait = wait  # type: ignore[attr-defined]
        with mock.patch.object(LOCK.os, "killpg", side_effect=killpg):
            LOCK.terminate_process_group(process)
        self.assertEqual(calls, [LOCK.signal.SIGTERM, LOCK.signal.SIGKILL])
        self.assertEqual(process.returncode, -9)


if __name__ == "__main__":
    unittest.main()
