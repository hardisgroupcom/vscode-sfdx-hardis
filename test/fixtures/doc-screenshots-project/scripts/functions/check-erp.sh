#!/usr/bin/env bash
# Fixture custom function for the documentation screenshots.
set -euo pipefail
echo "Pinging ${SFDX_HARDIS_IN_ENDPOINT}"
echo '{"erpStatus":"reachable"}'
