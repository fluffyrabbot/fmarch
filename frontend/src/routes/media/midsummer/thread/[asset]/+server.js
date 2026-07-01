import { error } from "@sveltejs/kit";
import { generatedThreadMediaPng } from "../../../../../lib/server/thread-media-png.mjs";

const MIDSUMMER_THREAD_MEDIA = Object.freeze({
  "receipt-442": Object.freeze({
    kind: "image",
    contentAddress: "midsummer-thread-receipt-442-canonical-raster",
    variants: Object.freeze({
      tablet: Object.freeze({
        width: 960,
        height: 720,
        palette: Object.freeze({
          background: Object.freeze([250, 250, 247]),
          accent: Object.freeze([93, 72, 59]),
          secondary: Object.freeze([231, 226, 217]),
          stripe: Object.freeze([133, 105, 83]),
        }),
      }),
      small: Object.freeze({
        width: 480,
        height: 360,
        palette: Object.freeze({
          background: Object.freeze([252, 252, 249]),
          accent: Object.freeze([67, 100, 111]),
          secondary: Object.freeze([221, 233, 236]),
          stripe: Object.freeze([99, 130, 139]),
        }),
      }),
    }),
  }),
});

export function GET({ params }) {
  const asset = _midsummerThreadAsset(params.asset);
  if (asset === null) {
    throw error(404, "midsummer fixture media variant unavailable");
  }
  const served = generatedThreadMediaPng(asset);
  return new Response(served.bytes, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "image/png",
      etag: served.etag,
      "x-fmarch-media-content-address": asset.contentAddress,
      "x-fmarch-media-fixture": "midsummer",
      "x-fmarch-media-reference": `midsummer/main/442/${asset.id}`,
      "x-fmarch-media-variant": asset.variantName,
    },
  });
}

export function _midsummerThreadAsset(assetName) {
  const match = /^(?<id>[a-z0-9-]+)-(?<variant>[a-z0-9-]+)\.png$/.exec(
    String(assetName ?? ""),
  );
  if (match === null) {
    return null;
  }
  const asset = MIDSUMMER_THREAD_MEDIA[match.groups.id];
  const variant = asset?.variants?.[match.groups.variant];
  if (asset === undefined || variant === undefined) {
    return null;
  }
  return Object.freeze({
    id: match.groups.id,
    kind: asset.kind,
    contentAddress: asset.contentAddress,
    variantName: match.groups.variant,
    ...variant,
  });
}
