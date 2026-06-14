#!/usr/bin/env python3
"""slice-watch — live view of a recursive-slice workflow run.

Usage:
  python3 slice-watch.py [latest|<run_dir>] [repo_path]
  watch -n 3 'python3 ~/.claude/scripts/slice-watch.py latest /Users/dh/dev/MailKit'

Renders the decomposition tree (roles inferred from each agent's result shape),
per-leaf trust verdicts, and the git "trust deposits" (commits since baseline).
Reads the workflow's journal.jsonl, which updates in real time.
"""
import sys, os, json, glob, time, subprocess

C = dict(dim='\033[2m', red='\033[31m', grn='\033[32m', ylw='\033[33m',
         cyn='\033[36m', bold='\033[1m', rst='\033[0m')

def find_latest():
    pats = glob.glob(os.path.expanduser(
        '~/.claude/projects/*/*/subagents/workflows/wf_*'))
    pats = [p for p in pats if os.path.isdir(p)]
    return max(pats, key=os.path.getmtime) if pats else None

def classify(r):
    """Infer the role of a completed agent from its structured result shape."""
    if not isinstance(r, dict): return ('?', str(r)[:60])
    if 'measureCommand' in r or 'gitSha' in r:
        return ('baseline', f"{str(r.get('currentState',''))[:48]} · "
                f"@{str(r.get('gitSha',''))[:8]} clean={r.get('gitClean')}")
    # ITEM 10: the merged 'decompose' decision — action plus (when action:'slice') the cut itself.
    if 'action' in r:
        if r.get('slices'):
            ds = [s.get('desc','')[:64] for s in r['slices']]
            return ('slice', f"→ slice · {len(ds)} slices\n" + "\n".join(f"      ├ {d}" for d in ds))
        return ('decompose', f"→ {r['action']}" + (f" · {r.get('riskTier')}" if r.get('riskTier') else ''))
    if 'slices' in r:   # the parallel-PARTITION result (Plan phase) — bare slices, no action
        ds = [s.get('desc','')[:64] for s in r['slices']]
        return ('slice', f"{len(ds)} slices\n" + "\n".join(f"      ├ {d}" for d in ds))
    if 'missing' in r:
        return ('critic', f"+{len(r['missing'])} missing scenario(s)")
    if 'passed' in r:
        cm = r.get('commits') or []
        return ('exec', f"passed={r.get('passed')} · commits={len(cm)} · "
                f"{str(r.get('summary',''))[:50]}")
    if 'trustworthy' in r:
        return ('verify', f"trustworthy={r.get('trustworthy')} · "
                f"{str(r.get('reason',''))[:60]}")
    return ('?', json.dumps(r)[:60])

ICON = {'baseline':'◆','decompose':'?','slice':'⑂','critic':'✎','exec':'⚙',
        'verify':'🛡','?':'·'}
COLOR = {'baseline':C['cyn'],'decompose':C['dim'],'slice':C['bold'],
         'critic':C['ylw'],'exec':C['rst'],'verify':C['cyn'],'?':C['dim']}

def main():
    run = sys.argv[1] if len(sys.argv) > 1 else 'latest'
    repo = sys.argv[2] if len(sys.argv) > 2 else None
    if run == 'latest': run = find_latest()
    if not run or not os.path.isdir(run):
        print("no run found"); return
    jp = os.path.join(run, 'journal.jsonl')
    started, results = [], {}
    base_sha = None
    if os.path.exists(jp):
        for line in open(jp):
            try: e = json.loads(line)
            except: continue
            aid = e.get('agentId')
            if e.get('type') == 'started': started.append(aid)
            elif e.get('type') == 'result':
                results[aid] = e.get('result')
                role, _ = classify(e.get('result'))
                if role == 'baseline' and isinstance(e.get('result'), dict):
                    base_sha = e['result'].get('gitSha') or base_sha
    running = [a for a in started if a not in results]
    mt = os.path.getmtime(jp) if os.path.exists(jp) else time.time()
    age = int(time.time() - mt)

    out = []
    out.append(f"{C['bold']}╭─ recursive-slice · {os.path.basename(run)} · "
               f"{len(results)} done, {len(running)} running · "
               f"updated {age}s ago{C['rst']}")
    for aid in started:
        if aid not in results: continue
        role, txt = classify(results[aid])
        c = COLOR.get(role, '')
        ic = ICON.get(role, '·')
        # color exec/verify by outcome
        r = results[aid]
        if role == 'exec' and isinstance(r, dict):
            c = C['grn'] if r.get('passed') else C['red']
        if role == 'verify' and isinstance(r, dict):
            c = C['grn'] if r.get('trustworthy') else C['red']
        out.append(f" {c}{ic} {role:<9}{C['rst']} {txt}")
    if running:
        out.append(f" {C['ylw']}▶ running   {len(running)} agent(s) working…{C['rst']}")

    # git trust deposits
    if repo and base_sha and os.path.isdir(os.path.join(repo, '.git')):
        try:
            log = subprocess.run(['git','-C',repo,'log','--oneline',
                                  f'{base_sha}..HEAD'], capture_output=True,
                                 text=True, timeout=5).stdout.strip()
            st = subprocess.run(['git','-C',repo,'status','--short'],
                                capture_output=True, text=True, timeout=5).stdout.strip()
            out.append(f"{C['cyn']}╰─ deposits (since @{base_sha[:8]}):{C['rst']}")
            for l in (log.splitlines() or ['(none yet)']):
                out.append(f"   {C['grn']}+{C['rst']} {l}")
            if st:
                out.append(f"   {C['dim']}uncommitted: "
                           f"{len(st.splitlines())} file(s){C['rst']}")
        except Exception as ex:
            out.append(f"   git: {ex}")
    print("\n".join(out))

if __name__ == '__main__':
    main()
