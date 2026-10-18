// Reuse the existing workstation service; never start another fitting daemon
// or a second Vite server as a side effect of opening the desktop interface.
try {
  const response = await fetch('http://127.0.0.1:48624/workbench', {signal: AbortSignal.timeout(5000)});
  const html = await response.text();
  if (!response.ok || !html.includes('id="workbench-panel"')) throw new Error('Unexpected studio response');
  console.log('Using the local Imagen studio on port 48624.');
} catch {
  console.error('Start Imagen with npm run dev in the repository root, then run the desktop app again.');
  process.exitCode = 1;
}
