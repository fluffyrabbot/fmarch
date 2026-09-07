-- Replace the best-effort media charge ledger with a recoverable operation
-- journal. Legacy finalized content is authoritative and becomes ready. A
-- legacy pending row retains enough identity to be reconciled, but receives an
-- already-expired install lease so no old process can still claim ownership.

ALTER TABLE ONLY public.media_upload_ledger
    RENAME COLUMN encoded_bytes TO stored_bytes;

ALTER TABLE ONLY public.media_upload_ledger
    RENAME CONSTRAINT media_upload_ledger_encoded_bytes_check
    TO media_upload_ledger_stored_bytes_check;

ALTER TABLE ONLY public.media_upload_ledger
    ADD COLUMN state text,
    ADD COLUMN lease_token uuid,
    ADD COLUMN lease_expires_at bigint,
    ADD COLUMN updated_at bigint;

-- Rows without a durable object identity cannot be recovered. Likewise,
-- deleting malformed legacy identifiers is safer than admitting object-store
-- paths that the current ContentId parser could never address.
DELETE FROM public.media_upload_ledger
WHERE content_id IS NULL
   OR content_id !~ '^(pending:)?[0-9a-f]{64}$';

UPDATE public.media_upload_ledger
SET content_id = substring(content_id FROM 9),
    state = 'installing',
    lease_token = upload_id,
    lease_expires_at = created_at,
    updated_at = created_at
WHERE content_id LIKE 'pending:%';

UPDATE public.media_upload_ledger
SET state = 'ready',
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = created_at
WHERE state IS NULL;

-- The legacy API could race two charges for identical canonical content.
-- Collapse those rows before installing the content identity key. Prefer a
-- completed row as the journal witness, while carrying forward the largest
-- historical charge as the conservative accounting value.
WITH ranked AS (
    SELECT upload_id,
           max(stored_bytes) OVER (
               PARTITION BY principal_id, content_id
           ) AS conservative_stored_bytes,
           row_number() OVER (
               PARTITION BY principal_id, content_id
               ORDER BY CASE state WHEN 'ready' THEN 0 ELSE 1 END,
                        updated_at DESC,
                        upload_id DESC
           ) AS ordinal
    FROM public.media_upload_ledger
)
UPDATE public.media_upload_ledger AS ledger
SET stored_bytes = ranked.conservative_stored_bytes
FROM ranked
WHERE ranked.ordinal = 1
  AND ledger.upload_id = ranked.upload_id;

WITH ranked AS (
    SELECT upload_id,
           row_number() OVER (
               PARTITION BY principal_id, content_id
               ORDER BY CASE state WHEN 'ready' THEN 0 ELSE 1 END,
                        updated_at DESC,
                        upload_id DESC
           ) AS ordinal
    FROM public.media_upload_ledger
)
DELETE FROM public.media_upload_ledger AS ledger
USING ranked
WHERE ranked.ordinal > 1
  AND ledger.upload_id = ranked.upload_id;

ALTER TABLE ONLY public.media_upload_ledger
    ALTER COLUMN content_id SET NOT NULL,
    ALTER COLUMN state SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL,
    ADD CONSTRAINT media_upload_ledger_content_id_check
        CHECK (content_id ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT media_upload_ledger_state_check
        CHECK (state IN ('installing', 'ready', 'reclaiming', 'failed')),
    ADD CONSTRAINT media_upload_ledger_lease_shape_check
        CHECK (
            (state IN ('installing', 'reclaiming')
             AND lease_token IS NOT NULL
             AND lease_expires_at IS NOT NULL)
            OR
            (state IN ('ready', 'failed')
             AND lease_token IS NULL
             AND lease_expires_at IS NULL)
        ),
    ADD CONSTRAINT media_upload_ledger_updated_at_check
        CHECK (updated_at >= created_at),
    ADD CONSTRAINT media_upload_ledger_principal_content_key
        UNIQUE (principal_id, content_id);

CREATE INDEX media_upload_ledger_active_lease_idx
    ON public.media_upload_ledger (lease_expires_at, principal_id, content_id)
    WHERE state IN ('installing', 'reclaiming');
