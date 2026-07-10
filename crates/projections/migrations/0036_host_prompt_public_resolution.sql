-- Typed public consequence of a resolved host prompt.

ALTER TABLE host_prompt
    ADD COLUMN IF NOT EXISTS public_resolution JSONB;
