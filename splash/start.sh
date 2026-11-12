#!/bin/sh
# Starts the drawing page's server, and restarts it if it stops, so a crash there can't take the site down.
# It runs as uid 1000, which owns the icons already on the splash-data volume.
(
  while true; do
    su-exec 1000:1000 node /app/server.mjs
    sleep 2
  done
) &
exec nginx -g 'daemon off;'
