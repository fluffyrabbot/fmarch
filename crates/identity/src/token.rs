use rand::RngCore;
use sha2::{Digest, Sha256};

/// Backend-issued app-session tokens are prefixed so bearer dispatch never has
/// to guess between an opaque session token and a provider JWT.
pub const APP_SESSION_TOKEN_PREFIX: &str = "fmss_";

pub fn is_app_session_token(token: &str) -> bool {
    token.starts_with(APP_SESSION_TOKEN_PREFIX)
}

/// 256 bits of OS randomness, hex-encoded under the app-session prefix. The
/// plaintext is returned to the caller exactly once; only its hash is stored.
pub fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let mut token = String::with_capacity(APP_SESSION_TOKEN_PREFIX.len() + bytes.len() * 2);
    token.push_str(APP_SESSION_TOKEN_PREFIX);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut token, "{byte:02x}");
    }
    token
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{generate_session_token, hash_token, is_app_session_token};

    #[test]
    fn generated_tokens_are_prefixed_unique_and_hash_stable() {
        let token = generate_session_token();
        assert!(is_app_session_token(token.as_str()));
        assert_eq!(token.len(), 5 + 64);
        assert_ne!(token, generate_session_token());
        assert_eq!(hash_token(token.as_str()), hash_token(token.as_str()));
        assert_ne!(hash_token(token.as_str()), hash_token("fmss_other"));
    }

    #[test]
    fn jwt_shaped_bearers_are_not_app_session_tokens() {
        assert!(!is_app_session_token("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.sig"));
        assert!(!is_app_session_token("account-session-1234"));
    }
}
