#!/bin/sh
# Runs last in the official nginx entrypoint, after 20-envsubst-on-templates.sh
# has rendered /etc/nginx/templates/*.template into /etc/nginx/conf.d/.
#
# Two jobs, and the first one is the important one.
#
# 1. Refuse to start on a config that is not ours. The image ships its own
#    /etc/nginx/conf.d/default.conf: the "Welcome to nginx!" page on port 80,
#    and no TLS whatsoever. If the template step is ever skipped, nginx comes up
#    perfectly happy serving that — which is the worst way to find out. Green
#    containers, a healthy port 80, and a stock welcome page on the domain
#    parents are typing in. (This is not hypothetical: overriding the service's
#    `command:` is enough to skip it, because the entrypoint only runs these
#    scripts when its first argument is `nginx`.) So check what is about to be
#    served, and die loudly rather than quietly serve the wrong thing.
#
# 2. Reload every 6 hours, so a certificate renewed by the certbot sidecar is
#    picked up without anyone having to restart anything.
set -e

CONF=/etc/nginx/conf.d/default.conf

if ! grep -q 'ssl_certificate ' "$CONF" 2>/dev/null; then
  echo "[nginx] FATAL: $CONF has no TLS in it, so it is not our rendered" >&2
  echo "[nginx]        template — most likely the image's stock default.conf." >&2
  echo "[nginx]        nginx would serve the welcome page on port 80 and no" >&2
  echo "[nginx]        HTTPS at all. Refusing to start." >&2
  echo "[nginx]        Check that deploy/nginx is mounted at /etc/nginx/templates" >&2
  echo "[nginx]        and that the nginx service does not override 'command'." >&2
  exit 1
fi

# Comments are allowed to talk about placeholders; directives are not allowed to
# contain one. envsubst leaves an undefined ${VAR} as literal text, and nginx
# then fails to parse it — better to say which one than to let nginx say
# "unknown directive".
if grep -v '^[[:space:]]*#' "$CONF" | grep -q '\${'; then
  echo "[nginx] FATAL: $CONF still has unsubstituted placeholders:" >&2
  grep -vn '^[[:space:]]*#' "$CONF" | grep '\${' >&2
  echo "[nginx]        Every \${VAR} in the template needs a variable in the" >&2
  echo "[nginx]        nginx service's environment, even an empty one." >&2
  exit 1
fi

# Orphaned on purpose: this outlives the script and is reparented to the nginx
# master that replaces the entrypoint.
( while :; do sleep 6h; nginx -s reload 2>/dev/null || true; done ) &

echo "[nginx] config verified; reloading every 6h for certificate renewals"
exit 0
