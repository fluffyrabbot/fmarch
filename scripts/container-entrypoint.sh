#!/bin/sh
set -eu

media_root="${FMARCH_MEDIA_ROOT:-/var/lib/fmarch/media}"

case "$media_root" in
  /*) ;;
  *)
    echo "FMARCH_MEDIA_ROOT must be an absolute path" >&2
    exit 64
    ;;
esac

if [ "$media_root" = "/" ]; then
  echo "FMARCH_MEDIA_ROOT must not be the filesystem root" >&2
  exit 64
fi

install --directory --owner=fmarch --group=fmarch --mode=0700 "$media_root"
chown --recursive fmarch:fmarch "$media_root"
chmod 0700 "$media_root"

exec gosu fmarch "$@"
