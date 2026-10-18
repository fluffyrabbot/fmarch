import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("rust_toolchain", pathlib.Path(__file__).with_name("check-rust-toolchain.py"))
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


class RustToolchainContract(unittest.TestCase):
    def setUp(self):
        self.toolchain = '[toolchain]\nchannel = "1.99.1"\nprofile = "minimal"\ncomponents = ["clippy", "rustfmt"]\n'
        self.docker = f'FROM rust:1.99.1-bookworm@sha256:{"a" * 64} AS chef\nARG FMARCH_CARGO_CACHE_NAMESPACE=fmarch-exact-image-rust-1.99.1\n'

    def test_matching_consumers(self):
        self.assertEqual(contract.validate_contract(self.toolchain, self.docker), "1.99.1")

    def test_rejects_drift_and_unpinned_inputs(self):
        for docker in (self.docker.replace("1.99.1-bookworm", "1.98.1-bookworm"), self.docker.replace("@sha256:" + "a" * 64, ""), self.docker.replace("rust-1.99.1", "rust-1.98.1")):
            with self.subTest(docker=docker), self.assertRaises(ValueError):
                contract.validate_contract(self.toolchain, docker)
        for source in (self.toolchain.replace("1.99.1", "stable"), self.toolchain.replace('"clippy", ', '')):
            with self.subTest(source=source), self.assertRaises(ValueError):
                contract.validate_contract(source, self.docker)

    def test_runtime_rejects_ambient_override(self):
        def matching(argv, **kwargs):
            return f"{argv[0]} 1.99.1 (test)"
        contract.validate_runtime("1.99.1", matching)
        for bad_tool in ("rustc", "cargo"):
            def mismatched(argv, **kwargs):
                return f"{argv[0]} {'1.98.1' if argv[0] == bad_tool else '1.99.1'} (test)"
            with self.subTest(tool=bad_tool), self.assertRaises(ValueError):
                contract.validate_runtime("1.99.1", mismatched)


if __name__ == "__main__":
    unittest.main()
