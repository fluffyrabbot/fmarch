-- Make the authority behind an in-flight delivery attempt survive process
-- failure and lease recovery. Existing processing rows predate explicit
-- provenance and are conservatively classified as automatic work.

ALTER TABLE ONLY public.auth_delivery_intent
    ADD COLUMN claim_source text,
    ADD COLUMN claim_actor_principal_id uuid;

UPDATE public.auth_delivery_intent
SET claim_source = 'automatic'
WHERE status = 'processing';

ALTER TABLE ONLY public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_claim_provenance_check
    CHECK (
        (
            status = 'processing'
            AND claim_source IS NOT NULL
            AND (
                (claim_source = 'automatic' AND claim_actor_principal_id IS NULL)
                OR
                (claim_source = 'explicit_retry' AND claim_actor_principal_id IS NOT NULL)
            )
        )
        OR
        (
            status <> 'processing'
            AND claim_source IS NULL
            AND claim_actor_principal_id IS NULL
        )
    );

CREATE FUNCTION public.auth_delivery_intent_attempt_count_monotonic() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.attempt_count < OLD.attempt_count THEN
        RAISE EXCEPTION 'identity delivery attempt_count cannot decrease';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER auth_delivery_intent_attempt_count_guard
    BEFORE UPDATE OF attempt_count ON public.auth_delivery_intent
    FOR EACH ROW
    EXECUTE FUNCTION public.auth_delivery_intent_attempt_count_monotonic();
