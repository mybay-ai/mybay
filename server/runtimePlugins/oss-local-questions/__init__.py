"""Local-only structured questions. No telemetry and no approval overrides."""
import json
import time
import uuid
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
from urllib.error import HTTPError, URLError


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _request(config, method, suffix, payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(config["url"] + suffix, data=body, method=method, headers={
        "Authorization": "Bearer " + config["token"],
        "Content-Type": "application/json",
    })
    # Never forward the instance credential to a proxy or redirect target.
    with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=5) as response:
        raw = response.read(32769)
        if len(raw) > 32768:
            raise ValueError("response too large")
        return json.loads(raw)


def ask_user(args, **kwargs):
    from tools.approval import get_current_session_key
    native_id = get_current_session_key(default="")
    session_id = kwargs.get("session_id") or kwargs.get("task_id")
    if not native_id or not session_id:
        return json.dumps({"error": "Structured questions require an active local API Run."})
    try:
        config = json.loads(Path(__file__).with_name("bridge.json").read_text())
        question_id = str(uuid.uuid4())
        payload = {"nativeRunId": native_id, "sessionId": session_id, "id": question_id, "spec": args}
        started = time.monotonic()
        question = None
        # Native Run mapping can be committed just after the tool starts.
        while time.monotonic() - started < 15:
            try:
                question = _request(config, "POST", "", payload)["question"]
                break
            except HTTPError as error:
                if error.code != 409:
                    raise
                time.sleep(1)
        if question is None:
            return json.dumps({"error": "The local Run is unavailable for questions."})
        from urllib.parse import urlencode
        query = urlencode({"nativeRunId": native_id, "sessionId": session_id})
        while time.monotonic() - started < 300:
            status = question.get("status")
            if status == "answered":
                return json.dumps({"status": "answered", "answer": question["answer"], "question": question["spec"]}, ensure_ascii=False)
            if status in ("expired", "rejected"):
                return json.dumps({"status": status, "message": "No answer was accepted. Do not invent a user choice."})
            time.sleep(1)
            try:
                question = _request(config, "GET", "/" + question_id + "?" + query)["question"]
            except HTTPError as error:
                if error.code in (401, 403, 404, 409, 410):
                    return json.dumps({"status": "expired", "message": "The question or Run is no longer available."})
            except (URLError, TimeoutError, OSError):
                # A controller restart must not cause a new question or Run.
                pass
        return json.dumps({"status": "expired", "message": "The question timed out. Do not invent a user choice."})
    except Exception:
        # URLs, tokens and provider details must not enter model-visible errors.
        return json.dumps({"error": "The local question bridge is unavailable."})


def register(ctx):
    if not Path(__file__).with_name("bridge.json").is_file():
        return
    ctx.register_tool(name="ask_user", toolset="oss_local_questions", handler=ask_user, schema={
        "name": "ask_user",
        "description": "Ask the user a structured question and WAIT for their answer in this same Run. Use this for choices instead of the unsupported clarify tool. Single selection uses multiple=false. Custom text is optional. Never invent answers. Ask one question at a time.",
        "parameters": {"type": "object", "additionalProperties": False, "required": ["title", "multiple", "allowCustom", "options"], "properties": {
            "title": {"type": "string", "maxLength": 2000},
            "multiple": {"type": "boolean"}, "allowCustom": {"type": "boolean"},
            "options": {"type": "array", "maxItems": 8, "items": {"type": "object", "additionalProperties": False, "required": ["id", "label"], "properties": {
                "id": {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,40}$"}, "label": {"type": "string", "maxLength": 200}
            }}}
        }}
    })
