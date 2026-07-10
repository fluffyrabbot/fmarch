import importlib.util
import json
import unittest
from pathlib import Path


TOOLS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOLS_ROOT.parent
SCRIPT = TOOLS_ROOT / "im_human_engine_inventory.py"
SPEC = importlib.util.spec_from_file_location("engine_inventory", SCRIPT)
inventory_module = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(inventory_module)


class ImHumanEngineInventoryTests(unittest.TestCase):
    def test_trigger_primitives_use_structured_pack_evidence(self):
        inventory = json.loads(
            (REPO_ROOT / "docs/arch/im-human-engine-inventory.json").read_text(
                encoding="utf-8"
            )
        )
        rows = inventory_module.build_matrix(
            inventory,
            inventory_module.load_fmarch_context(REPO_ROOT),
        )

        for primitive in ("super_saint", "visitor_kill"):
            row = next(
                row
                for row in rows
                if row["category"] == "primitive" and row["item"] == primitive
            )
            self.assertTrue(row["modeled_in_pack"], primitive)
            self.assertTrue(row["implemented_in_resolver"], primitive)
            self.assertTrue(row["covered_by_golden"], primitive)
            self.assertTrue(row["integrated_command_projection"], primitive)


if __name__ == "__main__":
    unittest.main()
