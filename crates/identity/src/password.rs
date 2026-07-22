use std::sync::OnceLock;

use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use uuid::Uuid;

use crate::error::IdentityFlowError;

pub fn hash_password_sync(password: &str) -> Result<String, IdentityFlowError> {
    let salt = SaltString::encode_b64(Uuid::new_v4().as_bytes()).map_err(|error| {
        IdentityFlowError::Internal(format!("could not generate account password salt: {error}"))
    })?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| {
            IdentityFlowError::Internal(format!("could not hash account password: {error}"))
        })
}

pub fn verify_password_sync(encoded_hash: &str, password: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(encoded_hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

/// A fixed hash consumed on lookups that miss, so response timing does not
/// reveal whether an account exists.
pub fn dummy_password_hash() -> &'static str {
    static DUMMY_HASH: OnceLock<String> = OnceLock::new();
    DUMMY_HASH
        .get_or_init(|| {
            hash_password_sync("fmarch-dummy-account-password")
                .expect("dummy account password hash must initialize")
        })
        .as_str()
}

#[cfg(test)]
mod tests {
    use super::{dummy_password_hash, hash_password_sync, verify_password_sync};

    #[test]
    fn argon2id_round_trip_and_dummy_hash() {
        let hash = hash_password_sync("correct horse battery staple").unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password_sync(hash.as_str(), "correct horse battery staple"));
        assert!(!verify_password_sync(hash.as_str(), "wrong password"));
        assert!(dummy_password_hash().starts_with("$argon2id$"));
        assert!(!verify_password_sync("not-a-hash", "anything"));
    }
}
