#!/bin/bash

# Shell script that bumps package versions marked for release via changesets.
# Runs the native `changeset version` command and updates the minimum dependency
# versions of packages not included in the release to prevent stale dependency version ranges.
# See the update-min-versions.ts script for more details.

# https://www.gnu.org/software/bash/manual/bash.html#The-Set-Builtin
set -euxo pipefail

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
ROOT_DIR="${DIR}/../../../.."

cd "${ROOT_DIR}"

# Write release metadata before bumping versions and consuming changesets
(cd build/dev/changesets && yarn write-release-info)
# Perform the standard changesets bump
yarn changeset version
# Update minimum version ranges of dependents
(cd build/dev/changesets && yarn update-min-versions)
