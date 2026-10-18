#!/usr/bin/env python3
"""Check compiler consumers against the repository's one Rust version authority."""
import argparse
import pathlib
import re
import subprocess
import tomllib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def validate_contract(toolchain, dockerfile):
    config = tomllib.loads(toolchain)["toolchain"]
    version = config["channel"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Rust channel must be an exact stable release")
    if config.get("profile") != "minimal" or set(config.get("components", [])) != {"clippy", "rustfmt"}:
        raise ValueError("Rust toolchain must use minimal with clippy and rustfmt")
    base = re.search(r"^FROM rust:([^\s]+) AS chef$", dockerfile, re.M)
    if not base or not re.fullmatch(re.escape(version) + r"-bookworm@sha256:[a-f0-9]{64}", base[1]):
        raise ValueError(f"Docker Rust builder must pin {version}-bookworm and its digest")
    namespace = re.search(r"^ARG FMARCH_CARGO_CACHE_NAMESPACE=(\S+)$", dockerfile, re.M)
    if not namespace or namespace[1] != f"fmarch-exact-image-rust-{version}":
        raise ValueError("Docker Cargo cache namespace must match the Rust toolchain")
    return version


def validate_runtime(version, execute=subprocess.check_output):
    for tool in ("rustc", "cargo"):
        actual = execute([tool, "--version"], cwd=ROOT, text=True, timeout=120).strip()
        if not actual.startswith(f"{tool} {version} "):
            raise ValueError(f"Expected {tool} {version}; got {actual}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", action="store_true")
    args = parser.parse_args()
    version = validate_contract((ROOT / "rust-toolchain.toml").read_text(), (ROOT / "Dockerfile").read_text())
    if args.runtime:
        validate_runtime(version)
    print(f"Rust {version}: version contract{' and runtime' if args.runtime else ''} passed")


if __name__ == "__main__":
    main()
