#!/bin/sh
# Exercises version bump + push against a throwaway local repo (no network).
# Covers: patch/minor/major, new branch, merge guard, multi-ref reject,
# and the clean `auto-bump then git push` path (pnpm push).
# Run: sh scripts/test-pre-push-hook.sh
set -e

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git init --bare -q "$tmp/remote.git"
git init -q -b main "$tmp/work"
cd "$tmp/work"
git config user.name test
git config user.email test@test.local
git config core.hooksPath .githooks
git remote add origin "$tmp/remote.git"

mkdir -p .githooks scripts
cp "$root/.githooks/pre-push" .githooks/pre-push
cp "$root/scripts/bump-version.mjs" scripts/bump-version.mjs
cp "$root/scripts/auto-bump-version.mjs" scripts/auto-bump-version.mjs
cp "$root/scripts/git-push.mjs" scripts/git-push.mjs
chmod +x .githooks/pre-push

fail=0
extract_version() {
  grep -m1 '"version"' | sed -E 's/.*"version": *"([^"]+)".*/\1/'
}
remote_sha() {
  git --git-dir="$tmp/remote.git" rev-parse --verify -q "refs/heads/$1" 2>/dev/null || echo "(none)"
}
assert_version() {
  branch="${3:-main}"
  remote_got=$(git --git-dir="$tmp/remote.git" show "refs/heads/$branch:package.json" 2>/dev/null | extract_version)
  if [ "$remote_got" != "$1" ]; then
    echo "FAIL: $2 — expected $1 on the remote, got $remote_got"
    fail=1
  else
    echo "PASS: $2 (remote version $remote_got)"
  fi
}
assert_exit_zero() {
  if [ "$1" -eq 0 ]; then
    echo "PASS: $2 (exit 0)"
  else
    echo "FAIL: $2 — expected exit 0, got $1"
    fail=1
  fi
}

echo '{"version":"1.0.0"}' >package.json
git add package.json
git commit -q -m "chore: init"
# git push cru com bump → exit ≠ 0 (self-push + cancel), remoto ok
git push -q origin main || true

echo "fix" >file.txt
git add file.txt
git commit -q -m "fix: patch-worthy change"
git push -q origin main || true
assert_version "1.0.2" "fix: bumps patch"

echo "feat" >file.txt
git add file.txt
git commit -q -m "feat: minor-worthy change"
git push -q origin main || true
assert_version "1.1.0" "feat: bumps minor"

echo "breaking" >file.txt
git add file.txt
git commit -q -m "feat!: breaking change"
git push -q origin main || true
assert_version "2.0.0" "feat!: bumps major"

git checkout -q -b side
echo "side" >file.txt
git add file.txt
git commit -q -m "fix: side branch change"
git push -q origin side || true
assert_version "2.0.1" "new branch: bumps from its actual fork point" side

git checkout -q main
git merge -q --no-ff side -m "Merge branch 'side' into main"
git push -q origin main || true
assert_version "2.0.1" "merge commit: guard skips a second bump"

before_a=$(remote_sha multi-a)
before_b=$(remote_sha multi-b)
git checkout -q -b multi-a main
git commit -q --allow-empty -m "fix: multi a"
git checkout -q -b multi-b main
git commit -q --allow-empty -m "fix: multi b"
git push origin multi-a multi-b >/dev/null 2>&1 || true
if [ "$(remote_sha multi-a)" = "$before_a" ] && [ "$(remote_sha multi-b)" = "$before_b" ]; then
  echo "PASS: pushing two refs at once is rejected (neither reached the remote)"
else
  echo "FAIL: pushing two refs at once should leave the remote untouched"
  fail=1
fi

# Caminho limpo (pnpm push): bump antes → git push exit 0
git checkout -q main
echo "clean" >file.txt
git add file.txt
git commit -q -m "fix: clean push path"
node scripts/auto-bump-version.mjs >/tmp/bump-out.txt || true
set +e
git push -q origin main
clean_status=$?
set -e
assert_exit_zero "$clean_status" "auto-bump then git push exits 0"
assert_version "2.0.2" "clean path: patch on remote"

exit $fail
