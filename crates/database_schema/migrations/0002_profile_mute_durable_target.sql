-- Move the current mute projection from the visibility-scoped public profile
-- row to the durable member profile identity. Every existing public profile is
-- backed by the same member_profile key, so the constraint can be replaced
-- without rewriting relationship state.

ALTER TABLE ONLY public.profile_mute
    DROP CONSTRAINT profile_mute_target_profile_id_fkey;

ALTER TABLE ONLY public.profile_mute
    ADD CONSTRAINT profile_mute_target_profile_id_fkey
    FOREIGN KEY (target_profile_id)
    REFERENCES public.member_profile(profile_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;
