#!/usr/bin/env bash
# Create an isolated worktree + branch for a feature (one feature = one worktree +
# one branch). The worktree is a sibling dir so it never pollutes the main checkout.
#
# Usage:  .ai/new-worktree.sh <branch-name>   e.g. .ai/new-worktree.sh feat/x
set -euo pipefail

BRANCH="${1:?usage: new-worktree.sh <branch-name>}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
SAFE="${BRANCH//\//-}"
WT_DIR="${REPO_ROOT}/../${REPO_NAME}--${SAFE}"

[ -e "$WT_DIR" ] && { echo "error: $WT_DIR already exists" >&2; exit 1; }

# Always base the new branch on the up-to-date DEFAULT branch (not whatever is
# currently checked out), so feature branches never accidentally fork off another
# feature branch. Resolve the default branch from origin/HEAD (fallback: main).
DEFAULT="$(git -C "$REPO_ROOT" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
DEFAULT="${DEFAULT:-main}"   # fallback when origin/HEAD isn't set (|| true so set -e doesn't abort)
git -C "$REPO_ROOT" fetch -q origin "$DEFAULT"

git -C "$REPO_ROOT" worktree add "$WT_DIR" -b "$BRANCH" "origin/$DEFAULT"
echo
echo "Worktree:  $WT_DIR"
echo "Branch:    $BRANCH  (based on origin/$DEFAULT)"
echo "Next:      cd '$WT_DIR' → install deps → run baseline gates before changes."
echo "Cleanup:   git -C '$REPO_ROOT' worktree remove '$WT_DIR'"
