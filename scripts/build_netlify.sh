#!/usr/bin/env bash
set -euo pipefail

api_origin="${PROD_API_LOCATION:-}"
if [[ ! "$api_origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "Set PROD_API_LOCATION to the deployed HTTPS API origin (hostname only; no path or trailing slash)." >&2
  exit 1
fi

publish_dir="netlify-publish"
mkdir -p "$publish_dir"
cp index.html login.html register.html app.js auth.css styles.css chat-workflow.js "$publish_dir/"

# Netlify reads netlify.toml before running the build command. Generate the
# redirects in the publish directory so deploy-time proxy rules use this site's
# configured API origin instead of a literal placeholder.
cat > "$publish_dir/_redirects" <<EOF
/captcha $api_origin/captcha 200!
/auth/* $api_origin/auth/:splat 200!
/chat $api_origin/chat 200!
/calls $api_origin/calls 200!
/calls/* $api_origin/calls/:splat 200!
/appointments $api_origin/appointments 200!
/appointments/* $api_origin/appointments/:splat 200!
/analytics/* $api_origin/analytics/:splat 200!
/export/* $api_origin/export/:splat 200!
/health $api_origin/health 200!
/config-status $api_origin/config-status 200!
EOF
