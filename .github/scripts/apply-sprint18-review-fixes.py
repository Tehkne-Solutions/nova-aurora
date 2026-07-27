import os
import subprocess

branch = os.environ.get("GITHUB_HEAD_REF", "agent/sprint-18-beta-telemetry-community")
script_path = ".github/scripts/apply-sprint18-review-fixes.py"

subprocess.run(["git", "fetch", "origin", "main", "--depth=1"], check=True)
subprocess.run(
    ["git", "checkout", "FETCH_HEAD", "--", ".github/workflows/ci.yml"],
    check=True,
)
subprocess.run(["git", "rm", script_path], check=True)
subprocess.run(["git", "config", "user.name", "Tehkne Solutions Automation"], check=True)
subprocess.run(
    ["git", "config", "user.email", "automation@users.noreply.github.com"],
    check=True,
)
subprocess.run(
    ["git", "commit", "-m", "chore(sprint18): restore standard CI workflow"],
    check=True,
)
subprocess.run(["git", "push", "origin", f"HEAD:{branch}"], check=True)
