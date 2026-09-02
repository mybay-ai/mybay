import json
import unittest

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("__init__.py")
SPEC = spec_from_file_location("oss_local_questions_plugin", MODULE_PATH)
PLUGIN = module_from_spec(SPEC)
SPEC.loader.exec_module(PLUGIN)


class WebExtractCompatibilityTest(unittest.TestCase):
    def test_accepts_non_empty_content_with_empty_error(self):
        result = json.dumps({
            "results": [{
                "url": "https://example.com/",
                "title": "Example Domain",
                "content": "# Example Domain",
                "error": None,
            }]
        })
        self.assertTrue(PLUGIN._web_extract_has_usable_result(result))

    def test_rejects_real_failures_and_invalid_payloads(self):
        failed = json.dumps({
            "results": [{
                "url": "https://example.invalid/",
                "content": "",
                "error": "request failed",
            }]
        })
        self.assertFalse(PLUGIN._web_extract_has_usable_result(failed))
        self.assertFalse(PLUGIN._web_extract_has_usable_result("not json"))
        self.assertFalse(PLUGIN._web_extract_has_usable_result(None))


if __name__ == "__main__":
    unittest.main()
