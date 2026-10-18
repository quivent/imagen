// @exec: {"yield_time_ms": 120000, "max_output_tokens": 2000}
// Run this file's contents in Codex functions.exec from Imagen, not Node or a shell.
// This does not run merely by importing/copying the file; invoking it generates queued artwork.
// It claims up to six jobs; reference/edit jobs are deferred without image viewing.
const located = await tools.exec_command({cmd: 'git rev-parse --show-toplevel', max_output_tokens: 500});
if (located.exit_code !== 0) throw new Error('Run this orchestration from an Imagen checkout.');
const repo = located.output.trim();
const installation = await tools.exec_command({cmd: 'test -f tools/artwork/IMPORT-MANIFEST.json', workdir: repo, max_output_tokens: 500});
if (installation.exit_code !== 0) throw new Error('This checkout does not contain the isolated Imagen artwork tools. No queue was opened.');
const stateOverride = load('artwork-runner-state') || null;
if (stateOverride !== null && (typeof stateOverride !== 'string' || !stateOverride.startsWith('/'))) {
  throw new Error('artwork-runner-state must be an absolute directory path.');
}
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
async function cli(args) {
  const result = await tools.exec_command({
    cmd: 'python3 tools/artwork/artwork.py ' + (stateOverride ? ['--state', stateOverride, ...args] : args).map(quote).join(' '),
    workdir: repo, max_output_tokens: 12000, yield_time_ms: 1000
  });
  let output = result.output;
  let session = result.session_id;
  let code = result.exit_code;
  while (session) {
    const next = await tools.write_stdin({ session_id: session, chars: '', yield_time_ms: 1000, max_output_tokens: 12000 });
    output += next.output; session = next.session_id; code = next.exit_code;
  }
  if (code !== 0) throw new Error(output);
  return JSON.parse(output);
}
const queued = await cli(['status']);
if (queued.jobs.some(row => row.backend === 'builtin' && row.state === 'queued' && row.spec.references?.length)) {
  throw new Error('Use a new-image-only research queue. Reference/edit jobs were not claimed or viewed.');
}
const packets = await cli(['next', '--count', '6', '--worker', 'codex-builtin-runner']);
await Promise.allSettled(packets.map(async packet => {
  if (packet.arguments.referenced_image_paths) {
    text({ job: packet.job, handoff: packet.receiptFile, next: 'Reference/edit handoff deferred. Do not view images or generate it in this new-image runner.' });
    return;
  }
  const started = Date.now();
  let stopped = false;
  let timer;
  const beat = async () => {
    if (stopped) return;
    try { await cli(['beat', packet.job, packet.token]); }
    catch (error) { text({ job: packet.job, heartbeat: error.message }); }
    if (!stopped) timer = setTimeout(beat, 30000);
  };
  timer = setTimeout(beat, 30000);
  try {
    const result = await tools.image_gen__imagegen(packet.arguments);
    const hint = result.output_hint || '';
    const paths = hint.match(/\/[^\s]*generated_images\/[^\s]+\.(?:png|webp|jpg)/g) || [];
    if (!paths.length) {
      store('artwork-result-' + packet.job, result);
      text({ job: packet.job, needsReceipt: true, output_hint: hint });
      return;
    }
    const source = paths[paths.length - 1];
    const receipt = { tool: packet.tool, arguments: packet.arguments, source,
                      generationSeconds: (Date.now() - started) / 1000 };
    // Persist the small receipt before conversion so a conversion failure can
    // be reconciled without another image request. This never writes image data.
    await tools.exec_command({workdir: repo, cmd:
      'python3 -c ' + quote('import pathlib,sys; pathlib.Path(sys.argv[1]).write_text(sys.argv[2])') +
      ' ' + quote(packet.receiptFile + '.result.json') + ' ' + quote(JSON.stringify(receipt)), max_output_tokens: 500});
    const saved = await cli(['complete', packet.job, packet.token, source, '--receipt-json', JSON.stringify(receipt)]);
    text({ job: packet.job, ...saved });
    generatedImage(result);
  } catch (error) {
    text({ job: packet.job, problem: error.message, next: 'Reconcile the persisted handoff/result; do not regenerate blindly.' });
  } finally {
    stopped = true; clearTimeout(timer);
  }
}));
