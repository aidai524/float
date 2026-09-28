#!/usr/bin/env bash
# 编译亮度工具。本机 CLT 的 MacOSX27.0 SDK 与 clang 不匹配，需用旧 SDK。
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="tools/bin"
mkdir -p "$OUT"

CANDIDATE_SDKS=(
  "/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
  "/Library/Developer/CommandLineTools/SDKs/MacOSX15.sdk"
  "/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk"
  "/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk"
  "$(xcrun --show-sdk-path 2>/dev/null || true)"
)

for sdk in "${CANDIDATE_SDKS[@]}"; do
  [ -n "$sdk" ] || continue
  [ -d "$sdk" ] || continue
  if clang -O2 -isysroot "$sdk" tools/brightness.c -o "$OUT/brightness" -framework CoreGraphics >/dev/null 2>&1; then
    echo "built tools/bin/brightness with SDK: $sdk"
    exit 0
  fi
done

echo "ERROR: 无法编译亮度工具，请检查 Xcode Command Line Tools" >&2
exit 1
