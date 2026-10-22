import time, subprocess
from pathlib import Path
root=Path('/workspace/artwork')
while not (root/'runtime-ready').exists():time.sleep(5)
while not (root/'models/flux1/.download-complete.json').exists():time.sleep(5)
subprocess.run(['supervisorctl','start','artwork-native-flux1'],check=True)
while not (root/'native/flux1.sock').exists():time.sleep(2)
subprocess.run(['supervisorctl','start','artwork-flux1'],check=True)
while not (root/'models/manifest.json').exists():time.sleep(5)
subprocess.run(['supervisorctl','start','artwork-flux2'],check=True)
print('Inference services started; proof renders and production cutover remain.',flush=True)
