import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("patch_api_server.py")
SPEC = importlib.util.spec_from_file_location("patch_api_server", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


FIXTURE = '''
    def _create_agent(
        self,
        *,
        stream_delta_callback=None,
        tool_progress_callback=None,
    ):
        agent_kwargs = {
            "stream_delta_callback": stream_delta_callback,
            "tool_progress_callback": tool_progress_callback,
        }

        # Also wire stream_delta_callback so message.delta events flow through.
        def _text_cb(delta):
            pass

        self._set_run_status("run", "queued")
        agent = self._create_agent(
                        stream_delta_callback=_text_cb,
                        tool_progress_callback=event_cb,
        )
'''


class PatchApiServerTest(unittest.TestCase):
    def test_adds_interim_callback_and_event(self):
        result = MODULE.patch_api_server(FIXTURE)
        self.assertIn("interim_assistant_callback=None", result)
        self.assertIn('"interim_assistant_callback": interim_assistant_callback', result)
        self.assertIn('"event": "message.interim"', result)
        self.assertIn("interim_assistant_callback=_interim_cb", result)

    def test_is_idempotent(self):
        once = MODULE.patch_api_server(FIXTURE)
        self.assertEqual(MODULE.patch_api_server(once), once)


if __name__ == "__main__":
    unittest.main()
