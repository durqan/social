#!/bin/sh
set -eu

marker_dir=/var/run/certbot-hooks
mkdir -p "$marker_dir"
date +%s > "$marker_dir/coturn-cert-renewed"
