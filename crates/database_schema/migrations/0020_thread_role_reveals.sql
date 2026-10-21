-- Roles a system post made public (RFC 0009). The projection decides the
-- list at write time from its own reveal flags, so a concealed or
-- alignment-only flip stores the empty list. Private rooms never carry one.
ALTER TABLE public.thread_view
    ADD COLUMN role_reveals jsonb DEFAULT '[]'::jsonb NOT NULL,
    ADD CONSTRAINT thread_view_role_reveals_shape CHECK (
        jsonb_typeof(role_reveals) = 'array'
        AND (channel_id = 'main' OR role_reveals = '[]'::jsonb)
    );
