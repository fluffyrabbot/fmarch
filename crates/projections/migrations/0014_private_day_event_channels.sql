-- 0014_private_day_event_channels.sql — seal private event narrative work and
-- admit only event-derived private channels.

-- The prior schema admitted only `main`, so every existing row is public and
-- can remain in its plaintext columns. New private rows are admitted only when
-- their template/rendered values occupy the sealed columns below.

ALTER TABLE public.day_event_narrative
    DROP CONSTRAINT day_event_narrative_channel_check,
    DROP CONSTRAINT day_event_narrative_body_check,
    DROP CONSTRAINT day_event_narrative_delivery_check,
    ALTER COLUMN body_template DROP NOT NULL,
    ADD COLUMN body_template_private JSONB,
    ADD COLUMN rendered_body_private JSONB,
    ADD CONSTRAINT day_event_narrative_channel_check CHECK (
        channel_id = 'main' OR channel_id LIKE 'private:event:_%'
    ),
    ADD CONSTRAINT day_event_narrative_template_storage_check CHECK (
        (
            channel_id = 'main'
            AND body_template IS NOT NULL
            AND btrim(body_template) <> ''
            AND body_template_private IS NULL
        )
        OR
        (
            channel_id LIKE 'private:event:_%'
            AND body_template IS NULL
            AND body_template_private IS NOT NULL
        )
    ),
    ADD CONSTRAINT day_event_narrative_rendered_storage_check CHECK (
        (rendered_body IS NULL AND rendered_body_private IS NULL)
        OR
        (
            channel_id = 'main'
            AND rendered_body IS NOT NULL
            AND rendered_body_private IS NULL
        )
        OR
        (
            channel_id LIKE 'private:event:_%'
            AND rendered_body IS NULL
            AND rendered_body_private IS NOT NULL
        )
    ),
    ADD CONSTRAINT day_event_narrative_delivery_check CHECK (
        (
            status = 'armed'
            AND source_seq IS NULL
            AND rendered_body IS NULL
            AND rendered_body_private IS NULL
            AND published_seq IS NULL
        )
        OR
        (
            status = 'pending'
            AND source_seq IS NOT NULL
            AND (
                (channel_id = 'main' AND rendered_body IS NOT NULL)
                OR
                (
                    channel_id LIKE 'private:event:_%'
                    AND rendered_body_private IS NOT NULL
                )
            )
            AND published_seq IS NULL
        )
        OR
        (
            status = 'published'
            AND source_seq IS NOT NULL
            AND (
                (channel_id = 'main' AND rendered_body IS NOT NULL)
                OR
                (
                    channel_id LIKE 'private:event:_%'
                    AND rendered_body_private IS NOT NULL
                )
            )
            AND published_seq IS NOT NULL
        )
    );
