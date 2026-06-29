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

git -C "$REPO_ROOT" worktree add "$WT_DIR" -b "$BRANCH"
echo
echo "Worktree:  $WT_DIR"
echo "Branch:    $BRANCH"
echo "Next:      cd '$WT_DIR' → install deps → run baseline gates before changes."
echo "Cleanup:   git -C '$REPO_ROOT' worktree remove '$WT_DIR'"
