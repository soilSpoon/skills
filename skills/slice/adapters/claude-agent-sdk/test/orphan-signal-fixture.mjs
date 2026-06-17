// Token-free fixture for the END-TO-END real-signal reaping test. It wires the PRODUCTION lifecycle
// (installHandlers) exactly as run.mjs does, spawns a tracked detached `sleep` (the build-tree
// stand-in), prints its pid, then idles until signalled. The parent test sends a REAL SIGTERM to
// THIS node process and asserts the sleep grandchild was reaped via the signal handler — i.e. it
// reproduces, and proves fixed, the exact `pkill -f run.mjs` failure mode that orphaned builds.
import { spawn } from 'node:child_process'
import { installHandlers, configurePidfile, trackProcessGroup } from '../lifecycle.mjs'

configurePidfile('/tmp/slice-signal-fixture')
installHandlers()
const child = spawn('/bin/sh', ['-c', 'sleep 300'], { detached: true })
trackProcessGroup(child.pid)
process.stdout.write('SLEEPPID:' + child.pid + '\n')
setInterval(() => {}, 1 << 30) // stay alive until the parent signals us
