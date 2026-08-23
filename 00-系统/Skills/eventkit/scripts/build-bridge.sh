#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_dir="$script_dir/eventkit-bridge"
executable="$package_dir/.build/release/eventkit-bridge"

swift build -c release --package-path "$package_dir" >/dev/null

if [ ! -x "$executable" ]; then
  echo "release executable was not created" >&2
  exit 1
fi

plist=$(otool -P "$executable")
for key in NSCalendarsFullAccessUsageDescription NSRemindersFullAccessUsageDescription; do
  if ! printf '%s\n' "$plist" | grep -Fq "$key"; then
    echo "release executable is missing $key" >&2
    exit 1
  fi
done

printf '%s\n' "$executable"
