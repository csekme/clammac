#!/usr/bin/env bash
# Copies the Homebrew ClamAV binaries + dylibs into resources/clamav/<arch>
# and rewrites the dylib install names to be relative (@executable_path),
# so they can be shipped inside the app bundle (Contents/Resources/clamav).
#
# Run on the target architecture (arm64 mac -> arm64 payload, intel -> x64).
set -euo pipefail

PREFIX="$(brew --prefix clamav)"
ARCH="$(uname -m)"
[ "$ARCH" = "arm64" ] && OUT_ARCH="arm64" || OUT_ARCH="x64"
OUT="$(cd "$(dirname "$0")/.." && pwd)/resources/clamav/$OUT_ARCH"

rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/lib"

for bin in clamd freshclam clamdscan clamscan sigtool; do
  src="$PREFIX/bin/$bin"
  [ -f "$PREFIX/sbin/$bin" ] && src="$PREFIX/sbin/$bin"
  [ -f "$src" ] && cp "$src" "$OUT/bin/"
done

# Collect transitive non-system dylib dependencies.
collect_deps() {
  otool -L "$1" | awk 'NR>1 {print $1}' | grep -Ev '^(/usr/lib|/System)' || true
}

queue=("$OUT"/bin/*)
seen=""
while [ ${#queue[@]} -gt 0 ]; do
  f="${queue[0]}"; queue=("${queue[@]:1}")
  for dep in $(collect_deps "$f"); do
    name="$(basename "$dep")"
    case "$seen" in *"|$name|"*) ;; *)
      seen="$seen|$name|"
      real="$dep"
      [ ! -f "$real" ] && real="$PREFIX/lib/$name"
      if [ -f "$real" ]; then
        cp -n "$real" "$OUT/lib/" 2>/dev/null || true
        queue+=("$OUT/lib/$name")
      fi
    ;; esac
  done
done

# Rewrite load paths: binaries look in ../lib, dylibs reference each other by @loader_path.
for f in "$OUT"/bin/*; do
  for dep in $(collect_deps "$f"); do
    install_name_tool -change "$dep" "@executable_path/../lib/$(basename "$dep")" "$f" 2>/dev/null || true
  done
  codesign --force --sign - "$f"
done
for f in "$OUT"/lib/*.dylib; do
  install_name_tool -id "@loader_path/$(basename "$f")" "$f" 2>/dev/null || true
  for dep in $(collect_deps "$f"); do
    install_name_tool -change "$dep" "@loader_path/$(basename "$dep")" "$f" 2>/dev/null || true
  done
  codesign --force --sign - "$f"
done

echo "ClamAV payload ready: $OUT"
