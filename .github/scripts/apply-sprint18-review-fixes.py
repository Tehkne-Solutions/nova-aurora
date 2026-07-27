from pathlib import Path

worker = Path("apps/worker/src/worker.ts")
text = worker.read_text(encoding="utf-8")
old = 'await betaTelemetry.recomputeDailyMetrics("worker",completedDate);'
new = 'await betaTelemetry.recomputeDailyMetrics(\n        "worker",\n        new Date(`${completedDate}T00:00:00.000Z`)\n      );'

if old in text:
    worker.write_text(text.replace(old, new, 1), encoding="utf-8")
elif new not in text:
    raise SystemExit("Expected telemetry recomputation call was not found.")
