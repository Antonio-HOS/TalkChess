#!/bin/sh
# Gera /tmp/.htpasswd a partir de APP_USER / APP_PASSWORD (executado pelo entrypoint do nginx).
set -eu

if [ -z "${APP_PASSWORD:-}" ]; then
  echo "[auth] ERRO: defina a variável APP_PASSWORD (senha de acesso ao sistema)." >&2
  exit 1
fi

USER_NAME="${APP_USER:-admin}"

case "$USER_NAME" in
  *:*) echo "[auth] ERRO: APP_USER não pode conter ':'." >&2; exit 1 ;;
esac

# A senha vai por stdin para não aparecer na lista de processos.
HASH="$(printf '%s' "$APP_PASSWORD" | openssl passwd -apr1 -stdin)"
printf '%s:%s\n' "$USER_NAME" "$HASH" > /tmp/.htpasswd
chmod 600 /tmp/.htpasswd

echo "[auth] proteção por senha ativa (usuário: $USER_NAME)"
