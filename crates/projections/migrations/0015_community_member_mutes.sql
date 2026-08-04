-- 0015_community_member_mutes.sql — private reversible member/profile mute relationships.

CREATE TABLE public.community_member_mute (
    relationship_id uuid NOT NULL,
    principal_user_id text NOT NULL,
    target_profile_id uuid NOT NULL,
    active boolean NOT NULL,
    updated_seq bigint NOT NULL,
    version bigint NOT NULL,
    CONSTRAINT community_member_mute_version_check CHECK (version > 0)
);

ALTER TABLE ONLY public.community_member_mute
    ADD CONSTRAINT community_member_mute_pkey PRIMARY KEY (relationship_id);
ALTER TABLE ONLY public.community_member_mute
    ADD CONSTRAINT community_member_mute_member_target_key
    UNIQUE (principal_user_id, target_profile_id);
ALTER TABLE ONLY public.community_member_mute
    ADD CONSTRAINT community_member_mute_target_profile_id_fkey
    FOREIGN KEY (target_profile_id) REFERENCES public.profile_public(profile_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX community_member_mute_member_page_idx
    ON public.community_member_mute (principal_user_id, active, updated_seq DESC, relationship_id DESC);
CREATE INDEX community_member_mute_target_idx
    ON public.community_member_mute (target_profile_id, active);
