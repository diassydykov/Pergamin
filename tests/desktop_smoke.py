"""Smoke only our own EXE process; never touches an existing app instance."""
import json
from pathlib import Path
import socket
import subprocess
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
with socket.socket() as probe:
    if probe.connect_ex(('127.0.0.1',8321))==0:
        raise RuntimeError('Port 8321 is occupied. Close the running app before the smoke test.')
process=subprocess.Popen([str(ROOT/'Pergamin.exe'),'--serve-only'],cwd=ROOT,creationflags=subprocess.CREATE_NO_WINDOW)
try:
    deadline=time.monotonic()+15
    while True:
        try:
            with urllib.request.urlopen('http://127.0.0.1:8321/',timeout=1) as response:
                assert b'library.js' in response.read()
            break
        except OSError:
            if process.poll() is not None or time.monotonic()>deadline:
                raise
            time.sleep(.1)
    for asset in ['library.js','library-import.js','library.css']:
        with urllib.request.urlopen('http://127.0.0.1:8321/'+asset,timeout=3) as response:
            assert response.status==200 and len(response.read())>100
    with urllib.request.urlopen('http://127.0.0.1:8321/catalog/starter.json',timeout=3) as response:
        data = json.load(response)['books']
        assert len(data)>=55 and any(b.get('genre')=='holmes' for b in data)
finally:
    subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True,check=False)
    process.wait(timeout=5)
print('DESKTOP SMOKE PASSED')
