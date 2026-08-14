-- 0020_sealed_event_body.sql — one opaque authenticated envelope per event body.
--
-- This greenfield cut refuses a nonempty pre-envelope store. No plaintext
-- compatibility bridge or partially encrypted row can enter the new contract.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.events) THEN
        RAISE EXCEPTION 'sealed event-body migration requires an empty greenfield event store';
    END IF;
END
$$;

ALTER TABLE public.events
    DROP COLUMN payload,
    DROP COLUMN actor,
    DROP COLUMN causation_id,
    DROP COLUMN meta,
    ADD COLUMN sealed_version smallint NOT NULL,
    ADD COLUMN sealed_kid text NOT NULL,
    ADD COLUMN sealed_nonce bytea NOT NULL,
    ADD COLUMN sealed_body bytea NOT NULL;

ALTER TABLE public.events
    ADD CONSTRAINT events_sealed_body_shape CHECK (
        sealed_version = 2
        AND octet_length(sealed_kid) BETWEEN 1 AND 128
        AND sealed_kid = btrim(sealed_kid)
        AND octet_length(sealed_nonce) = 24
        AND octet_length(sealed_body) >= 16
    );
