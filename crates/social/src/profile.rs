//! Pure social-profile domain model.
//!
//! A profile is a social presentation owned by an active platform principal.
//! It is deliberately not a generic "user" record: credentials and authority
//! belong to identity, while game personas remain game-local identities.
//!
//! The profile aggregate has two lifecycle states:
//! - [`ProfileLifecycle::Active`] retains an owner and an editable presentation.
//! - [`ProfileLifecycle::Redacted`] deliberately removes the principal and
//!   presentation, leaving only a non-principal retained attribution alias.
//!
//! Database uniqueness (one active profile per principal and one active profile
//! per handle) is a cross-aggregate invariant. Repositories must enforce it
//! transactionally; this module owns the per-profile state machine only.

use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// Event kind for a profile's initial presentation.
pub const PROFILE_CREATED: &str = "ProfileCreated";
/// Event kind for an active profile presentation edit.
pub const PROFILE_UPDATED: &str = "ProfileUpdated";
/// Event kind for irreversible profile redaction.
pub const PROFILE_REDACTED: &str = "ProfileRedacted";

const HANDLE_MIN_BYTES: usize = 3;
const HANDLE_MAX_BYTES: usize = 32;
const DISPLAY_NAME_MAX_BYTES: usize = 80;
const BIO_MAX_BYTES: usize = 1_000;
const REDACTED_ALIAS_PREFIX: &str = "former-member-";

macro_rules! uuid_id {
    ($name:ident, $description:literal) => {
        #[doc = $description]
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            /// Wrap an already-generated UUID.
            pub const fn from_uuid(value: Uuid) -> Self {
                Self(value)
            }

            /// Return the UUID used for persistence and transport adapters.
            pub const fn as_uuid(self) -> Uuid {
                self.0
            }

            /// Consume this typed identifier into its UUID representation.
            pub const fn into_uuid(self) -> Uuid {
                self.0
            }
        }

        impl From<Uuid> for $name {
            fn from(value: Uuid) -> Self {
                Self::from_uuid(value)
            }
        }

        impl From<$name> for Uuid {
            fn from(value: $name) -> Self {
                value.into_uuid()
            }
        }

        impl FromStr for $name {
            type Err = uuid::Error;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                Ok(Self::from_uuid(Uuid::parse_str(value)?))
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

/// Stable, opaque authorization identity for an active profile owner.
///
/// Principal storage is presently text-backed across the platform. This value
/// object prevents it from being confused with a profile, privacy subject, or
/// redaction alias while leaving the eventual repo-wide UUID re-key explicit.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct PrincipalId(String);

impl PrincipalId {
    /// Validate and normalize an opaque principal identifier.
    pub fn new(value: impl AsRef<str>) -> Result<Self, ProfileValueError> {
        let normalized = value.as_ref().trim();
        if normalized.is_empty() {
            return Err(ProfileValueError::InvalidPrincipalId);
        }
        Ok(Self(normalized.to_owned()))
    }

    /// The normalized opaque principal identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume this value into its normalized opaque representation.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for PrincipalId {
    type Error = ProfileValueError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<PrincipalId> for String {
    fn from(value: PrincipalId) -> Self {
        value.into_inner()
    }
}

impl FromStr for PrincipalId {
    type Err = ProfileValueError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value)
    }
}

impl AsRef<str> for PrincipalId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for PrincipalId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

uuid_id!(
    PrivacySubjectId,
    "Privacy/erasure identity associated with a profile owner."
);
uuid_id!(ProfileId, "Stable aggregate identity for a social profile.");

/// A validated, publicly routable profile handle.
///
/// Handles are normalized to trimmed lowercase ASCII and intentionally do not
/// admit redaction aliases. [`RedactedProfileAlias`] is a distinct type.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ProfileHandle(String);

impl ProfileHandle {
    /// Validate and normalize a user-supplied handle.
    pub fn new(value: impl AsRef<str>) -> Result<Self, ProfileValueError> {
        let normalized = value.as_ref().trim().to_ascii_lowercase();
        let valid_length = (HANDLE_MIN_BYTES..=HANDLE_MAX_BYTES).contains(&normalized.len());
        let valid_characters = normalized
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_');
        if !valid_length || !valid_characters {
            return Err(ProfileValueError::InvalidHandle);
        }
        Ok(Self(normalized))
    }

    /// The normalized handle text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume this value into normalized handle text.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for ProfileHandle {
    type Error = ProfileValueError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<ProfileHandle> for String {
    fn from(value: ProfileHandle) -> Self {
        value.into_inner()
    }
}

impl FromStr for ProfileHandle {
    type Err = ProfileValueError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value)
    }
}

impl AsRef<str> for ProfileHandle {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for ProfileHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// A validated profile display name.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ProfileDisplayName(String);

impl ProfileDisplayName {
    /// Validate and normalize a display name.
    pub fn new(value: impl AsRef<str>) -> Result<Self, ProfileValueError> {
        let normalized = value.as_ref().trim();
        if normalized.is_empty() || normalized.len() > DISPLAY_NAME_MAX_BYTES {
            return Err(ProfileValueError::InvalidDisplayName);
        }
        Ok(Self(normalized.to_owned()))
    }

    /// The normalized display name.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume this value into normalized display-name text.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for ProfileDisplayName {
    type Error = ProfileValueError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<ProfileDisplayName> for String {
    fn from(value: ProfileDisplayName) -> Self {
        value.into_inner()
    }
}

impl FromStr for ProfileDisplayName {
    type Err = ProfileValueError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value)
    }
}

impl AsRef<str> for ProfileDisplayName {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for ProfileDisplayName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// A validated profile biography.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ProfileBio(String);

impl ProfileBio {
    /// Validate and normalize a biography.
    pub fn new(value: impl AsRef<str>) -> Result<Self, ProfileValueError> {
        let normalized = value.as_ref().trim();
        if normalized.is_empty() || normalized.len() > BIO_MAX_BYTES {
            return Err(ProfileValueError::InvalidBio);
        }
        Ok(Self(normalized.to_owned()))
    }

    /// The normalized biography.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume this value into normalized biography text.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for ProfileBio {
    type Error = ProfileValueError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<ProfileBio> for String {
    fn from(value: ProfileBio) -> Self {
        value.into_inner()
    }
}

impl FromStr for ProfileBio {
    type Err = ProfileValueError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::new(value)
    }
}

impl AsRef<str> for ProfileBio {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for ProfileBio {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Visibility guaranteed by the current profile model.
///
/// `Private` is owner-only. There is intentionally no `Members` value here:
/// an audience policy needs a defined membership relation and viewer-aware read
/// path before it can become a valid product state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileVisibility {
    /// Eligible for public profile and search projections.
    Public,
    /// Available only through owner/editor reads.
    Private,
}

impl ProfileVisibility {
    /// Whether a public projection may materialize this presentation.
    pub const fn is_public(self) -> bool {
        matches!(self, Self::Public)
    }
}

impl FromStr for ProfileVisibility {
    type Err = ProfileValueError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim() {
            "public" => Ok(Self::Public),
            "private" => Ok(Self::Private),
            _ => Err(ProfileValueError::InvalidVisibility),
        }
    }
}

impl fmt::Display for ProfileVisibility {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Public => "public",
            Self::Private => "private",
        })
    }
}

/// A privacy-safe, deterministic alias retained after profile redaction.
///
/// This is not a [`PrincipalId`] or [`ProfileHandle`]. It is only suitable for
/// preserved historical attribution after the active profile has been erased.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RedactedProfileAlias(String);

impl RedactedProfileAlias {
    /// Produce the one canonical retained alias for a profile stream.
    pub fn for_profile(profile_id: ProfileId) -> Self {
        Self(format!(
            "{REDACTED_ALIAS_PREFIX}{}",
            profile_id.as_uuid().simple()
        ))
    }

    /// Validate a previously persisted canonical retained alias.
    pub fn parse(value: impl AsRef<str>) -> Result<Self, ProfileValueError> {
        let value = value.as_ref();
        let Some(suffix) = value.strip_prefix(REDACTED_ALIAS_PREFIX) else {
            return Err(ProfileValueError::InvalidRedactedAlias);
        };
        let valid_suffix = suffix.len() == 32
            && suffix.bytes().all(|byte| {
                byte.is_ascii_digit() || matches!(byte, b'a' | b'b' | b'c' | b'd' | b'e' | b'f')
            });
        if !valid_suffix {
            return Err(ProfileValueError::InvalidRedactedAlias);
        }
        Ok(Self(value.to_owned()))
    }

    /// The retained public-attribution text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume this value into its retained-attribution text.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for RedactedProfileAlias {
    type Error = ProfileValueError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(value)
    }
}

impl From<RedactedProfileAlias> for String {
    fn from(value: RedactedProfileAlias) -> Self {
        value.into_inner()
    }
}

impl FromStr for RedactedProfileAlias {
    type Err = ProfileValueError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

impl AsRef<str> for RedactedProfileAlias {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for RedactedProfileAlias {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// A monotonically increasing profile revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProfileRevision(u64);

impl ProfileRevision {
    /// Revision before a profile has received its first event.
    pub const INITIAL: Self = Self(0);

    /// Construct a revision from a validated storage sequence.
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    /// The storage-friendly revision number.
    pub const fn as_u64(self) -> u64 {
        self.0
    }

    fn next(self) -> Result<Self, ProfileFoldError> {
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or(ProfileFoldError::RevisionOverflow)
    }
}

impl fmt::Display for ProfileRevision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// The active identity binding for a profile.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProfileOwner {
    /// Durable authorization identity. Never replace this with a redacted alias.
    pub principal_id: PrincipalId,
    /// Privacy/erasure boundary for this active owner.
    pub privacy_subject_id: PrivacySubjectId,
}

impl ProfileOwner {
    /// Bind the active authorization and privacy identities.
    pub const fn new(principal_id: PrincipalId, privacy_subject_id: PrivacySubjectId) -> Self {
        Self {
            principal_id,
            privacy_subject_id,
        }
    }
}

/// The editable social presentation of an active profile.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProfilePresentation {
    /// Stable public route key. It is not changed by an edit command.
    pub handle: ProfileHandle,
    pub display_name: ProfileDisplayName,
    pub bio: ProfileBio,
    pub visibility: ProfileVisibility,
}

impl ProfilePresentation {
    /// Build a presentation from validated value objects.
    pub const fn new(
        handle: ProfileHandle,
        display_name: ProfileDisplayName,
        bio: ProfileBio,
        visibility: ProfileVisibility,
    ) -> Self {
        Self {
            handle,
            display_name,
            bio,
            visibility,
        }
    }

    fn apply(&self, edit: &ProfileEdit) -> Self {
        Self {
            handle: self.handle.clone(),
            display_name: edit.display_name.clone(),
            bio: edit.bio.clone(),
            visibility: edit.visibility,
        }
    }
}

/// The editable part of a profile presentation.
///
/// Handle changes are intentionally excluded: they need a separate registry
/// policy and conflict protocol rather than an incidental profile edit.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProfileEdit {
    pub display_name: ProfileDisplayName,
    pub bio: ProfileBio,
    pub visibility: ProfileVisibility,
}

impl ProfileEdit {
    /// Build an edit from validated value objects.
    pub const fn new(
        display_name: ProfileDisplayName,
        bio: ProfileBio,
        visibility: ProfileVisibility,
    ) -> Self {
        Self {
            display_name,
            bio,
            visibility,
        }
    }

    fn changes(&self, presentation: &ProfilePresentation) -> bool {
        self.display_name != presentation.display_name
            || self.bio != presentation.bio
            || self.visibility != presentation.visibility
    }
}

/// The lifecycle of a profile aggregate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileLifecycle {
    Active,
    Redacted,
}

/// State retained for an active, editable profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveProfile {
    pub profile_id: ProfileId,
    pub owner: ProfileOwner,
    pub presentation: ProfilePresentation,
    pub revision: ProfileRevision,
}

/// State retained after redaction.
///
/// There is deliberately no [`PrincipalId`] or active presentation here. The
/// retained alias is a public historical label, not an authorization identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RedactedProfile {
    pub profile_id: ProfileId,
    pub privacy_subject_id: PrivacySubjectId,
    pub retained_alias: RedactedProfileAlias,
    pub revision: ProfileRevision,
}

/// The complete profile aggregate state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "lifecycle", rename_all = "snake_case")]
pub enum ProfileState {
    Active(ActiveProfile),
    Redacted(RedactedProfile),
}

impl ProfileState {
    /// The immutable aggregate ID.
    pub const fn profile_id(&self) -> ProfileId {
        match self {
            Self::Active(profile) => profile.profile_id,
            Self::Redacted(profile) => profile.profile_id,
        }
    }

    /// The privacy subject that remains associated with this aggregate.
    pub const fn privacy_subject_id(&self) -> PrivacySubjectId {
        match self {
            Self::Active(profile) => profile.owner.privacy_subject_id,
            Self::Redacted(profile) => profile.privacy_subject_id,
        }
    }

    /// The revision after the last folded event.
    pub const fn revision(&self) -> ProfileRevision {
        match self {
            Self::Active(profile) => profile.revision,
            Self::Redacted(profile) => profile.revision,
        }
    }

    /// Current lifecycle without exposing the backing state representation.
    pub const fn lifecycle(&self) -> ProfileLifecycle {
        match self {
            Self::Active(_) => ProfileLifecycle::Active,
            Self::Redacted(_) => ProfileLifecycle::Redacted,
        }
    }

    /// Return active state when the profile is still editable.
    pub const fn active(&self) -> Option<&ActiveProfile> {
        match self {
            Self::Active(profile) => Some(profile),
            Self::Redacted(_) => None,
        }
    }

    /// Return redacted state when active identity has been removed.
    pub const fn redacted(&self) -> Option<&RedactedProfile> {
        match self {
            Self::Active(_) => None,
            Self::Redacted(profile) => Some(profile),
        }
    }
}

/// A profile command that has already crossed the HTTP/transport boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProfileCommand {
    /// Establish the first active owner and social presentation.
    Create {
        owner: ProfileOwner,
        presentation: ProfilePresentation,
    },
    /// Change an active presentation, with ownership and optimistic concurrency.
    Update {
        editor: PrincipalId,
        expected_revision: ProfileRevision,
        edit: ProfileEdit,
    },
    /// Irreversibly remove the active owner/presentation after an external
    /// privacy workflow has authorized the action.
    Redact { expected_revision: ProfileRevision },
}

/// A typed profile event. Stream identity is carried by [`ProfileId`] outside
/// this payload, so it is not duplicated in every event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProfileEvent {
    Created {
        owner: ProfileOwner,
        presentation: ProfilePresentation,
    },
    Updated {
        edit: ProfileEdit,
    },
    Redacted {
        retained_alias: RedactedProfileAlias,
    },
}

impl ProfileEvent {
    /// Stable persistence/event-store kind.
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Created { .. } => PROFILE_CREATED,
            Self::Updated { .. } => PROFILE_UPDATED,
            Self::Redacted { .. } => PROFILE_REDACTED,
        }
    }
}

/// Rejections from deciding a command against a profile aggregate.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ProfileDecisionError {
    #[error("profile already exists")]
    AlreadyExists,
    #[error("profile does not exist")]
    NotFound,
    #[error("profile has been redacted")]
    Redacted,
    #[error("profile editing requires the active owner")]
    NotOwner,
    #[error("profile revision conflict: expected {expected}, actual {actual}")]
    RevisionConflict {
        expected: ProfileRevision,
        actual: ProfileRevision,
    },
    #[error("profile edit does not change its presentation")]
    NoChanges,
}

/// Errors from replaying an invalid event sequence.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ProfileFoldError {
    #[error("profile creation event requires an empty stream")]
    CreatedExisting,
    #[error("profile event requires an existing profile")]
    MissingProfile,
    #[error("profile cannot be updated after redaction")]
    UpdatedRedacted,
    #[error("profile cannot be redacted twice")]
    RedactedTwice,
    #[error("profile revision overflow")]
    RevisionOverflow,
}

/// Validation failures for profile value objects.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ProfileValueError {
    #[error("principal ID must not be blank")]
    InvalidPrincipalId,
    #[error("profile handle must be 3 to 32 lowercase letters, digits, or underscores")]
    InvalidHandle,
    #[error("profile display name must contain 1 to 80 bytes")]
    InvalidDisplayName,
    #[error("profile bio must contain 1 to 1000 bytes")]
    InvalidBio,
    #[error("profile visibility must be public or private")]
    InvalidVisibility,
    #[error("profile revision must be a non-negative integer")]
    InvalidRevision,
    #[error("redacted profile alias must use the canonical former-member-<uuid> form")]
    InvalidRedactedAlias,
}

/// Decide a profile command without touching storage, clocks, or networking.
pub fn decide_profile(
    state: Option<&ProfileState>,
    command: ProfileCommand,
) -> Result<Vec<ProfileEvent>, ProfileDecisionError> {
    match (state, command) {
        (
            None,
            ProfileCommand::Create {
                owner,
                presentation,
            },
        ) => Ok(vec![ProfileEvent::Created {
            owner,
            presentation,
        }]),
        (Some(_), ProfileCommand::Create { .. }) => Err(ProfileDecisionError::AlreadyExists),
        (None, ProfileCommand::Update { .. } | ProfileCommand::Redact { .. }) => {
            Err(ProfileDecisionError::NotFound)
        }
        (
            Some(ProfileState::Redacted(_)),
            ProfileCommand::Update { .. } | ProfileCommand::Redact { .. },
        ) => Err(ProfileDecisionError::Redacted),
        (
            Some(ProfileState::Active(profile)),
            ProfileCommand::Update {
                editor,
                expected_revision,
                edit,
            },
        ) => {
            ensure_revision(profile.revision, expected_revision)?;
            if editor != profile.owner.principal_id {
                return Err(ProfileDecisionError::NotOwner);
            }
            if !edit.changes(&profile.presentation) {
                return Err(ProfileDecisionError::NoChanges);
            }
            Ok(vec![ProfileEvent::Updated { edit }])
        }
        (Some(ProfileState::Active(profile)), ProfileCommand::Redact { expected_revision }) => {
            ensure_revision(profile.revision, expected_revision)?;
            Ok(vec![ProfileEvent::Redacted {
                retained_alias: RedactedProfileAlias::for_profile(profile.profile_id),
            }])
        }
    }
}

fn ensure_revision(
    actual: ProfileRevision,
    expected: ProfileRevision,
) -> Result<(), ProfileDecisionError> {
    if actual == expected {
        Ok(())
    } else {
        Err(ProfileDecisionError::RevisionConflict { expected, actual })
    }
}

/// Fold one typed profile event into aggregate state.
///
/// `profile_id` comes from the profile event stream, not the payload, to keep
/// the identifier single-sourced.
pub fn fold_profile_event(
    profile_id: ProfileId,
    state: Option<&ProfileState>,
    event: &ProfileEvent,
) -> Result<ProfileState, ProfileFoldError> {
    match (state, event) {
        (
            None,
            ProfileEvent::Created {
                owner,
                presentation,
            },
        ) => Ok(ProfileState::Active(ActiveProfile {
            profile_id,
            owner: owner.clone(),
            presentation: presentation.clone(),
            revision: ProfileRevision::INITIAL.next()?,
        })),
        (Some(_), ProfileEvent::Created { .. }) => Err(ProfileFoldError::CreatedExisting),
        (None, ProfileEvent::Updated { .. } | ProfileEvent::Redacted { .. }) => {
            Err(ProfileFoldError::MissingProfile)
        }
        (Some(ProfileState::Redacted(_)), ProfileEvent::Updated { .. }) => {
            Err(ProfileFoldError::UpdatedRedacted)
        }
        (Some(ProfileState::Redacted(_)), ProfileEvent::Redacted { .. }) => {
            Err(ProfileFoldError::RedactedTwice)
        }
        (Some(ProfileState::Active(profile)), ProfileEvent::Updated { edit }) => {
            Ok(ProfileState::Active(ActiveProfile {
                profile_id: profile.profile_id,
                owner: profile.owner.clone(),
                presentation: profile.presentation.apply(edit),
                revision: profile.revision.next()?,
            }))
        }
        (Some(ProfileState::Active(profile)), ProfileEvent::Redacted { retained_alias }) => {
            Ok(ProfileState::Redacted(RedactedProfile {
                profile_id: profile.profile_id,
                privacy_subject_id: profile.owner.privacy_subject_id,
                retained_alias: retained_alias.clone(),
                revision: profile.revision.next()?,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn principal(value: u128) -> PrincipalId {
        PrincipalId::new(format!("principal-{value}")).unwrap()
    }

    fn subject(value: u128) -> PrivacySubjectId {
        PrivacySubjectId::from_uuid(Uuid::from_u128(value))
    }

    fn profile_id(value: u128) -> ProfileId {
        ProfileId::from_uuid(Uuid::from_u128(value))
    }

    fn presentation(visibility: ProfileVisibility) -> ProfilePresentation {
        ProfilePresentation::new(
            ProfileHandle::new("Example_User").unwrap(),
            ProfileDisplayName::new("  Example User  ").unwrap(),
            ProfileBio::new("  A concise biography.  ").unwrap(),
            visibility,
        )
    }

    fn create_command() -> ProfileCommand {
        ProfileCommand::Create {
            owner: ProfileOwner::new(principal(1), subject(2)),
            presentation: presentation(ProfileVisibility::Public),
        }
    }

    fn active_state() -> ProfileState {
        let event = decide_profile(None, create_command())
            .unwrap()
            .pop()
            .unwrap();
        fold_profile_event(profile_id(3), None, &event).unwrap()
    }

    fn edit(visibility: ProfileVisibility) -> ProfileEdit {
        ProfileEdit::new(
            ProfileDisplayName::new("Edited User").unwrap(),
            ProfileBio::new("Updated biography.").unwrap(),
            visibility,
        )
    }

    #[test]
    fn values_normalize_at_the_domain_boundary() {
        assert_eq!(
            PrincipalId::new("  principal-1  ").unwrap().as_str(),
            "principal-1"
        );
        assert_eq!(
            ProfileHandle::new("  Example_User  ").unwrap().as_str(),
            "example_user"
        );
        assert_eq!(
            ProfileDisplayName::new("  Example User  ")
                .unwrap()
                .as_str(),
            "Example User"
        );
        assert_eq!(
            ProfileBio::new("  A concise biography.  ")
                .unwrap()
                .as_str(),
            "A concise biography."
        );
    }

    #[test]
    fn values_reject_the_old_alias_and_unimplemented_members_audience() {
        assert_eq!(
            PrincipalId::new("  "),
            Err(ProfileValueError::InvalidPrincipalId)
        );
        assert_eq!(
            ProfileHandle::new("former-member-00000000000000000000000000000003"),
            Err(ProfileValueError::InvalidHandle)
        );
        assert_eq!(
            "members".parse::<ProfileVisibility>(),
            Err(ProfileValueError::InvalidVisibility)
        );
    }

    #[test]
    fn create_update_and_fold_preserve_typed_owner_and_revision() {
        let initial = active_state();
        assert_eq!(initial.lifecycle(), ProfileLifecycle::Active);
        assert_eq!(initial.revision(), ProfileRevision::new(1));
        assert_eq!(
            initial.active().unwrap().presentation.handle.as_str(),
            "example_user"
        );

        let events = decide_profile(
            Some(&initial),
            ProfileCommand::Update {
                editor: principal(1),
                expected_revision: ProfileRevision::new(1),
                edit: edit(ProfileVisibility::Private),
            },
        )
        .unwrap();
        assert_eq!(events[0].kind(), PROFILE_UPDATED);
        let updated = fold_profile_event(profile_id(3), Some(&initial), &events[0]).unwrap();
        let active = updated.active().unwrap();
        assert_eq!(updated.revision(), ProfileRevision::new(2));
        assert_eq!(active.presentation.display_name.as_str(), "Edited User");
        assert_eq!(active.presentation.visibility, ProfileVisibility::Private);
        assert_eq!(active.owner.principal_id, principal(1));
    }

    #[test]
    fn update_requires_current_owner_revision_and_a_real_change() {
        let state = active_state();
        assert_eq!(
            decide_profile(
                Some(&state),
                ProfileCommand::Update {
                    editor: principal(99),
                    expected_revision: state.revision(),
                    edit: edit(ProfileVisibility::Private),
                },
            ),
            Err(ProfileDecisionError::NotOwner)
        );
        assert_eq!(
            decide_profile(
                Some(&state),
                ProfileCommand::Update {
                    editor: principal(1),
                    expected_revision: ProfileRevision::INITIAL,
                    edit: edit(ProfileVisibility::Private),
                },
            ),
            Err(ProfileDecisionError::RevisionConflict {
                expected: ProfileRevision::INITIAL,
                actual: ProfileRevision::new(1),
            })
        );
        let active = state.active().unwrap();
        assert_eq!(
            decide_profile(
                Some(&state),
                ProfileCommand::Update {
                    editor: principal(1),
                    expected_revision: state.revision(),
                    edit: ProfileEdit::new(
                        active.presentation.display_name.clone(),
                        active.presentation.bio.clone(),
                        active.presentation.visibility,
                    ),
                },
            ),
            Err(ProfileDecisionError::NoChanges)
        );
    }

    #[test]
    fn redaction_drops_principal_and_uses_a_distinct_alias_type() {
        let state = active_state();
        let event = decide_profile(
            Some(&state),
            ProfileCommand::Redact {
                expected_revision: state.revision(),
            },
        )
        .unwrap()
        .pop()
        .unwrap();
        let ProfileEvent::Redacted { retained_alias } = &event else {
            panic!("expected redaction event");
        };
        assert_eq!(
            retained_alias.as_str(),
            "former-member-00000000000000000000000000000003"
        );
        let redacted = fold_profile_event(profile_id(3), Some(&state), &event).unwrap();
        assert_eq!(redacted.lifecycle(), ProfileLifecycle::Redacted);
        assert!(redacted.active().is_none());
        let redacted = redacted.redacted().unwrap();
        assert_eq!(redacted.privacy_subject_id, subject(2));
        assert_eq!(redacted.revision, ProfileRevision::new(2));
        assert_eq!(
            decide_profile(
                Some(&ProfileState::Redacted(redacted.clone())),
                ProfileCommand::Update {
                    editor: principal(1),
                    expected_revision: redacted.revision,
                    edit: edit(ProfileVisibility::Public),
                },
            ),
            Err(ProfileDecisionError::Redacted)
        );
    }

    #[test]
    fn invalid_event_sequences_do_not_fold() {
        let updated = ProfileEvent::Updated {
            edit: edit(ProfileVisibility::Public),
        };
        assert_eq!(
            fold_profile_event(profile_id(3), None, &updated),
            Err(ProfileFoldError::MissingProfile)
        );

        let state = active_state();
        let created = decide_profile(None, create_command())
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            fold_profile_event(profile_id(3), Some(&state), &created),
            Err(ProfileFoldError::CreatedExisting)
        );
    }

    #[test]
    fn value_objects_reject_invalid_deserialization() {
        let invalid_handle = serde_json::from_str::<ProfileHandle>("\"no\"");
        assert!(invalid_handle.is_err());
        let invalid_alias = serde_json::from_str::<RedactedProfileAlias>("\"former-member-nope\"");
        assert!(invalid_alias.is_err());
        let visibility = serde_json::from_str::<ProfileVisibility>("\"private\"").unwrap();
        assert_eq!(visibility, ProfileVisibility::Private);
    }

    #[test]
    fn state_round_trips_without_turning_aliases_into_principals() {
        let active = active_state();
        let active_json = serde_json::to_value(&active).unwrap();
        assert_eq!(active_json["lifecycle"], "active");
        assert_eq!(
            serde_json::from_value::<ProfileState>(active_json).unwrap(),
            active
        );

        let redaction = decide_profile(
            Some(&active),
            ProfileCommand::Redact {
                expected_revision: active.revision(),
            },
        )
        .unwrap()
        .pop()
        .unwrap();
        let redacted = fold_profile_event(profile_id(3), Some(&active), &redaction).unwrap();
        let redacted_json = serde_json::to_value(&redacted).unwrap();
        assert_eq!(redacted_json["lifecycle"], "redacted");
        assert!(redacted_json.get("principal_id").is_none());
        assert_eq!(
            serde_json::from_value::<ProfileState>(redacted_json).unwrap(),
            redacted
        );
    }
}
