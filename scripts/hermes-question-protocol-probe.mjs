import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Explicit local image only: no pull, credentials, host mounts, network or ports.
// This probes the SDK and image source, not a credentialed HTTP/model run.
const image = process.argv[2];
if (!image || image.startsWith('-') || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/hermes-question-protocol-probe.mjs <local-image-id-or-tag>');
}
const imageId = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
  encoding: 'utf8', timeout: 15000,
}).trim();
const name = `mybay-question-probe-${randomUUID()}`;
const python = String.raw`
import ast, json, os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

home = Path(os.environ['HERMES_HOME'])
plugin = home / 'plugins' / 'oss-question-probe'
plugin.mkdir(parents=True)
(plugin / 'plugin.yaml').write_text('''name: oss-question-probe
version: 0.0.1
description: Isolated OSS question protocol probe; not a product bridge.
provides_tools:
  - oss_question_probe
''')
(plugin / '__init__.py').write_text('''import json
from tools.approval import get_current_session_key
def probe(args, **kwargs):
    return json.dumps({"nativeRunId": get_current_session_key(default=""), "sessionId": kwargs.get("session_id"), "taskId": kwargs.get("task_id")})
def register(ctx):
    ctx.register_tool(name="oss_question_probe", toolset="oss_question_probe", schema={"name": "oss_question_probe", "description": "Return synthetic context for an isolated probe.", "parameters": {"type": "object", "properties": {}}}, handler=probe)
''')
(home / 'config.yaml').write_text('''model:
  provider: openai-api
  default: probe-only
toolsets:
  - oss_question_probe
platform_toolsets:
  api_server:
    - oss_question_probe
plugins:
  enabled:
    - oss-question-probe
''')

# Extract literal feature/route declarations without booting a gateway.
source = Path('/opt/hermes/gateway/platforms/api_server.py').read_text()
tree = ast.parse(source)
handler = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == '_handle_capabilities')
feature_keys = []
for node in ast.walk(handler):
    if isinstance(node, ast.Dict):
        for key, value in zip(node.keys, node.values):
            if isinstance(key, ast.Constant) and key.value == 'features' and isinstance(value, ast.Dict):
                feature_keys = [k.value for k in value.keys if isinstance(k, ast.Constant)]
routes = sorted({n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value.startswith('/v1/') and '\n' not in n.value})
question_routes = [r for r in routes if any(k in r.lower() for k in ['question', 'clarify', 'answer'])]
question_features = [k for k in feature_keys if any(s in k.lower() for s in ['question', 'clarify', 'answer'])]

from hermes_cli.config import load_config
from hermes_cli.tools_config import _get_platform_tools
from hermes_cli.plugins import discover_plugins
from model_tools import get_tool_definitions, handle_function_call
from tools.approval import set_current_session_key, reset_current_session_key
from tools.thread_context import propagate_context_to_thread
from tools.clarify_tool import clarify_tool

discover_plugins()
toolsets = sorted(_get_platform_tools(load_config(), 'api_server', include_default_mcp_servers=False))
definitions = get_tool_definitions(toolsets, quiet_mode=True, skip_tool_search_assembly=True)
names = sorted(d.get('function', d).get('name', '') for d in definitions)
assert 'oss_question_probe' in names, names

def dispatch():
    return json.loads(handle_function_call('oss_question_probe', {}, task_id='synthetic-session', session_id='synthetic-session', enabled_tools=['oss_question_probe'], enabled_toolsets=toolsets))
token = set_current_session_key('synthetic-native-run')
try:
    direct = dispatch()
    with ThreadPoolExecutor(max_workers=1) as pool:
        threaded = pool.submit(propagate_context_to_thread(dispatch)).result(timeout=15)
finally:
    reset_current_session_key(token)
assert direct['nativeRunId'] == 'synthetic-native-run', direct
assert threaded['nativeRunId'] == 'synthetic-native-run', threaded
unbound = dispatch()
assert unbound['nativeRunId'] == '', unbound
clarify_result = json.loads(clarify_tool('Probe only?', ['A', 'B']))
assert 'not available in this execution context' in json.dumps(clarify_result), clarify_result

print('OSS_QUESTION_PROBE=' + json.dumps({
    'version': 1, 'scope': 'isolated-image-sdk-and-source',
    'approvalFeatureAdvertised': 'run_approval_response' in feature_keys,
    'nativeQuestionFeatureDeclarations': question_features,
    'nativeQuestionRouteLiterals': question_routes,
    'pluginToolExposed': True,
    'dispatcherNativeRunContext': direct['nativeRunId'],
    'workerNativeRunContext': threaded['nativeRunId'],
    'unboundContextEmpty': unbound['nativeRunId'] == '',
    'clarifyWithoutCallbackUnavailable': True,
    'httpRunVerified': False, 'modelResumeVerified': False,
    'browserVerified': False
}))
`;
try {
  const output = execFileSync('docker', [
    'run', '--rm', '-i', '--pull=never', '--name', name,
    '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=1g', '--cpus=1',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m',
    '--tmpfs', '/probe-home:rw,nosuid,nodev,size=64m',
    '-e', 'HERMES_HOME=/probe-home', '-e', 'HOME=/probe-home',
    '-e', 'PYTHONDONTWRITEBYTECODE=1', '-e', 'HERMES_BUNDLED_PLUGINS=/probe-home/no-bundled-plugins',
    '--entrypoint', '/opt/hermes/.venv/bin/python', imageId, '-',
  ], { input: python, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
  const line = output.split(/\r?\n/).find(value => value.startsWith('OSS_QUESTION_PROBE='));
  if (!line) throw new Error('Probe did not produce a result');
  console.log(JSON.stringify({ imageId, ...JSON.parse(line.slice('OSS_QUESTION_PROBE='.length)) }, null, 2));
} finally {
  // On timeout, remove only this uniquely named, task-owned probe container.
  try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 15000 }); } catch { /* --rm already removed it */ }
}
