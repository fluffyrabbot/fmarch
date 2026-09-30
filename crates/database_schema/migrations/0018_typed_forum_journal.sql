-- Integration facts commit with their source event. Only routing headers are
-- public: payloads are sealed with the source stream key and authenticated
-- against the source identity, fact position, context, and schema version.
CREATE TABLE public.event_integration_outbox (
    source_seq bigint NOT NULL,
    fact_index integer NOT NULL,
    context text NOT NULL,
    kind text NOT NULL,
    version smallint NOT NULL,
    sealed_version smallint NOT NULL,
    stream_key_epoch bigint NOT NULL,
    sealed_nonce bytea NOT NULL,
    sealed_body bytea NOT NULL,
    CONSTRAINT event_integration_outbox_pkey PRIMARY KEY (source_seq, fact_index),
    CONSTRAINT event_integration_outbox_source_seq_fkey
        FOREIGN KEY (source_seq) REFERENCES public.events(seq),
    CONSTRAINT event_integration_outbox_position_check
        CHECK (source_seq > 0 AND fact_index >= 0),
    CONSTRAINT event_integration_outbox_header_check
        CHECK (context <> '' AND kind <> '' AND version > 0),
    CONSTRAINT event_integration_outbox_sealed_body_shape
        CHECK (sealed_version = 1 AND stream_key_epoch > 0
            AND octet_length(sealed_nonce) = 24 AND octet_length(sealed_body) >= 16)
);

CREATE TRIGGER event_integration_outbox_no_mutation
    BEFORE DELETE OR UPDATE OR TRUNCATE ON public.event_integration_outbox
    FOR EACH STATEMENT EXECUTE FUNCTION public.events_forbid_mutation();

-- An immutable admission reservation owns slug uniqueness independently of
-- the disposable discussion_area projection. The reservation and area event
-- are inserted in one transaction; replay validates their agreement.
CREATE TABLE public.forum_area_reservation (
    area_id uuid NOT NULL,
    slug text NOT NULL,
    CONSTRAINT forum_area_reservation_pkey PRIMARY KEY (area_id),
    CONSTRAINT forum_area_reservation_slug_key UNIQUE (slug),
    CONSTRAINT forum_area_reservation_slug_check CHECK (slug <> '')
);

CREATE TRIGGER forum_area_reservation_no_mutation
    BEFORE DELETE OR UPDATE OR TRUNCATE ON public.forum_area_reservation
    FOR EACH STATEMENT EXECUTE FUNCTION public.events_forbid_mutation();
