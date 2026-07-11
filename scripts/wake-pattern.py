#!/usr/bin/env python3
"""Wake-pattern analysis for schienbiz services — cpu datapoints from Render metrics API.
Buckets awake-minutes by Taipei hour-of-day and counts wake episodes (gap >5min = new episode)
to distinguish: workday block (dashboard polling) / evenly spaced spikes (external poller) /
discrete spread wakes (dense cron topology).
"""
import json, sys, urllib.request, datetime, collections

ENV = "/Users/chuchuchien0430/CloudSync/ai-project-manager/.env"
env = {}
for line in open(ENV):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k] = v.strip().strip('"').strip("'")
KEY = env["RENDER_API_KEY_SCHIENBIZ"]

def api(path):
    req = urllib.request.Request("https://api.render.com" + path,
        headers={"Authorization": "Bearer " + KEY, "Accept": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=20))

TARGETS = ["intelligence-journal", "leave-bot"]  # travel-advisor retired 2026-07-12 (suspended)
svcs = {d["service"]["name"]: d["service"]["id"] for d in api("/v1/services?limit=50")
        if d["service"]["name"] in TARGETS}

now = datetime.datetime.now(datetime.timezone.utc)
start = now - datetime.timedelta(hours=48)
TPE = datetime.timezone(datetime.timedelta(hours=8))

for name, sid in svcs.items():
    series = api(f"/v1/metrics/cpu?resource={sid}&startTime={start.isoformat().replace('+00:00','Z')}&endTime={now.isoformat().replace('+00:00','Z')}")
    ts = sorted({v["timestamp"] for s in (series if isinstance(series, list) else []) for v in (s.get("values") or [])})
    times = [datetime.datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(TPE) for t in ts]
    hours = collections.Counter(t.strftime("%m-%d %H") for t in times)
    # episodes: gap > 5 min starts a new one
    episodes = 0
    prev = None
    ep_lens, cur = [], 0
    for t in times:
        if prev is None or (t - prev).total_seconds() > 300:
            episodes += 1
            if cur: ep_lens.append(cur)
            cur = 0
        cur += 1
        prev = t
    if cur: ep_lens.append(cur)
    print(f"== {name} ({sid}) — 48h awake={len(times)}min, episodes={episodes}, "
          f"ep_len min/med/max={min(ep_lens) if ep_lens else 0}/{sorted(ep_lens)[len(ep_lens)//2] if ep_lens else 0}/{max(ep_lens) if ep_lens else 0}min")
    for hk in sorted(hours):
        n = hours[hk]
        print(f"  {hk}h {'#' * (n // 4)}{'' if n >= 4 else '.'} {n}min")
