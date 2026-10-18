#!/usr/bin/env bash
# Lists the Ubuntu source packages of the system libraries an AppImage bundles, with the written offer
# for their source code (LGPL and GPL). Run on the machine that built the AppImage, so dpkg knows the
# packages the libraries came from. Writes <AppImage>.sources.txt next to it.
#   bash scripts/appimage-sources.sh path/to/App.AppImage
set -euo pipefail

appimage="$(realpath "$1")"
out="$appimage.sources.txt"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

chmod +x "$appimage"
(cd "$work" && "$appimage" --appimage-extract >/dev/null)

. /etc/os-release
missing=()
declare -A sources=()
while IFS= read -r lib; do
  name="$(basename "$lib")"
  # The file the library was copied from: the same name under a system library folder.
  owner="$(dpkg -S "*/$name" 2>/dev/null | grep -E ' /(usr/)?lib/' | head -n 1 | cut -d: -f1 || true)"
  if [[ -z "$owner" ]]; then
    missing+=("$name")
    continue
  fi
  source="$(dpkg-query -W -f '${source:Package} ${source:Version}' "$owner:amd64" 2>/dev/null ||
    dpkg-query -W -f '${source:Package} ${source:Version}' "$owner")"
  sources["$source"]=1
done < <(find "$work/squashfs-root" -type f \( -name '*.so' -o -name '*.so.*' \) | sort)

{
  cat <<EOF
SOURCE CODE OFFER FOR THE LIBRARIES BUNDLED IN $(basename "$appimage")

This AppImage includes system libraries from ${PRETTY_NAME}, unmodified, so that it runs without them
being installed. Some are under the GNU Lesser General Public License or the GNU General Public License.
Backtickle itself is under the MIT License and links to them dynamically.

For at least three years from the date this AppImage was published, and for as long as it is offered
for download, Masud Rahman will give anyone who asks a complete machine-readable copy of the
corresponding source code of these libraries, on a medium customarily used for software interchange,
for no more than the cost of providing it. Ask by opening an issue at
https://github.com/masud90/backtickle/issues. The same sources are also published by Ubuntu: run
\`apt-get source <package>=<version>\` on ${PRETTY_NAME}, or download them from
https://launchpad.net/ubuntu/+source/<package>/<version>.

Each library's copyright and license notice is in usr/share/doc inside the AppImage (extract it with
--appimage-extract).

Ubuntu source packages (package version):
EOF
  printf '%s\n' "${!sources[@]}" | sort
  if ((${#missing[@]})); then
    echo
    echo "Libraries whose package could not be determined:"
    printf '%s\n' "${missing[@]}" | sort -u
  fi
} >"$out"

echo "Wrote $out: ${#sources[@]} source packages, ${#missing[@]} libraries without a package"
if ((${#missing[@]})); then
  echo "::warning::No package found for: ${missing[*]}"
fi
