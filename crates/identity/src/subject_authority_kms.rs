//! AWS KMS custody for the subject-authority wrapping key.
//!
//! Hosted processes never receive the wrapping key in plaintext. They hold
//! its KMS ciphertext plus a credential that may only call `kms:Decrypt` on
//! one key, from the environment's app hosts, with an encryption context that
//! names the environment and purpose (`infra/modules/environment/kms.tf`).
//! The key is unwrapped once at startup; revoking the KMS grant takes effect
//! at the next restart and never couples readiness to KMS availability.
//!
//! The single SigV4-signed `TrentService.Decrypt` call is implemented here
//! instead of pulling the AWS SDK into the identity crate.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::subject_privacy::SubjectPrivacyError;

pub(crate) const WRAP_KEY_CIPHERTEXT_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_WRAP_KEY_CIPHERTEXT";
pub(crate) const KMS_KEY_ARN_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_KMS_KEY_ARN";
pub(crate) const KMS_ACCESS_KEY_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_KMS_ACCESS_KEY_ID";
pub(crate) const KMS_SECRET_KEY_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_KMS_SECRET_ACCESS_KEY";
pub(crate) const KMS_ENVIRONMENT_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_ENVIRONMENT";
/// Debug-only override so tests can point the client at a local fake.
pub(crate) const KMS_ENDPOINT_ENV: &str = "FMARCH_SUBJECT_AUTHORITY_KMS_ENDPOINT";

pub const WRAP_KEY_ENCRYPTION_PURPOSE: &str = "subject-authority-wrap";
const KMS_TARGET: &str = "TrentService.Decrypt";
const KMS_CONTENT_TYPE: &str = "application/x-amz-json-1.1";
const KMS_TIMEOUT: Duration = Duration::from_secs(10);
const KMS_MAX_RESPONSE_BYTES: usize = 16 * 1024;

type HmacSha256 = Hmac<Sha256>;

/// Everything needed to unwrap the subject-authority wrapping key.
#[derive(Clone)]
pub struct KmsWrapKeySource {
    pub key_arn: String,
    pub region: String,
    pub environment: String,
    pub ciphertext: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub endpoint: String,
}

impl std::fmt::Debug for KmsWrapKeySource {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("KmsWrapKeySource")
            .field("key_arn", &self.key_arn)
            .field("region", &self.region)
            .field("environment", &self.environment)
            .field("ciphertext", &"<opaque>")
            .field("access_key_id", &"<redacted>")
            .field("secret_access_key", &"<redacted>")
            .field("endpoint", &self.endpoint)
            .finish()
    }
}

#[derive(Serialize)]
struct DecryptRequest<'a> {
    #[serde(rename = "CiphertextBlob")]
    ciphertext_blob: &'a str,
    #[serde(rename = "KeyId")]
    key_id: &'a str,
    #[serde(rename = "EncryptionAlgorithm")]
    encryption_algorithm: &'static str,
    #[serde(rename = "EncryptionContext")]
    encryption_context: BTreeMap<&'static str, &'a str>,
}

#[derive(Deserialize)]
struct DecryptResponse {
    #[serde(rename = "KeyId")]
    key_id: String,
    #[serde(rename = "Plaintext")]
    plaintext: String,
}

impl KmsWrapKeySource {
    pub fn from_environment() -> Result<Self, SubjectPrivacyError> {
        let key_arn = required(KMS_KEY_ARN_ENV)?;
        let region = kms_region_from_arn(&key_arn)?;
        let environment = required(KMS_ENVIRONMENT_ENV)?;
        if !matches!(environment.as_str(), "staging" | "production") {
            return Err(SubjectPrivacyError::Configuration(format!(
                "{KMS_ENVIRONMENT_ENV} must be staging or production"
            )));
        }
        let ciphertext = required(WRAP_KEY_CIPHERTEXT_ENV)?;
        STANDARD.decode(&ciphertext).map_err(|error| {
            SubjectPrivacyError::Configuration(format!(
                "{WRAP_KEY_CIPHERTEXT_ENV} must be base64: {error}"
            ))
        })?;
        let endpoint = match std::env::var(KMS_ENDPOINT_ENV) {
            Err(std::env::VarError::NotPresent) => format!("https://kms.{region}.amazonaws.com"),
            Ok(value) if cfg!(debug_assertions) => value,
            _ => {
                return Err(SubjectPrivacyError::Configuration(format!(
                    "{KMS_ENDPOINT_ENV} is unavailable in release builds"
                )))
            }
        };
        Ok(Self {
            key_arn,
            region,
            environment,
            ciphertext,
            access_key_id: required(KMS_ACCESS_KEY_ENV)?,
            secret_access_key: required(KMS_SECRET_KEY_ENV)?,
            endpoint,
        })
    }

    /// Call KMS once and return the 32-byte wrapping key. The plaintext KMS
    /// returns is the canonical base64 text that `wrap-authority-key.sh`
    /// encrypted.
    pub async fn decrypt(&self) -> Result<[u8; 32], SubjectPrivacyError> {
        let url = url::Url::parse(&self.endpoint).map_err(|error| {
            SubjectPrivacyError::Configuration(format!("KMS endpoint is invalid: {error}"))
        })?;
        let host = match (url.host_str(), url.port()) {
            (Some(host), Some(port)) => format!("{host}:{port}"),
            (Some(host), None) => host.to_string(),
            (None, _) => {
                return Err(SubjectPrivacyError::Configuration(
                    "KMS endpoint has no host".to_string(),
                ))
            }
        };
        let body = serde_json::to_vec(&DecryptRequest {
            ciphertext_blob: &self.ciphertext,
            key_id: &self.key_arn,
            encryption_algorithm: "SYMMETRIC_DEFAULT",
            encryption_context: BTreeMap::from([
                ("fmarch:environment", self.environment.as_str()),
                ("fmarch:purpose", WRAP_KEY_ENCRYPTION_PURPOSE),
            ]),
        })
        .map_err(|error| SubjectPrivacyError::Serialization(error.to_string()))?;
        let amz_date = amz_date(SystemTime::now());
        let headers = [
            ("content-type", KMS_CONTENT_TYPE),
            ("host", host.as_str()),
            ("x-amz-date", amz_date.as_str()),
            ("x-amz-target", KMS_TARGET),
        ];
        let authorization = sigv4_authorization(&SigningRequest {
            method: "POST",
            path: "/",
            headers: &headers,
            payload: &body,
            access_key_id: &self.access_key_id,
            secret_access_key: &self.secret_access_key,
            region: &self.region,
            service: "kms",
            amz_date: &amz_date,
        });
        let client = reqwest::Client::builder()
            .timeout(KMS_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .https_only(!cfg!(debug_assertions))
            .build()
            .map_err(|error| kms_error(format!("client: {error}")))?;
        let response = client
            .post(url)
            .header("content-type", KMS_CONTENT_TYPE)
            .header("x-amz-date", &amz_date)
            .header("x-amz-target", KMS_TARGET)
            .header("authorization", authorization)
            .body(body)
            .send()
            .await
            .map_err(|error| kms_error(format!("request: {error}")))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| kms_error(format!("response: {error}")))?;
        if bytes.len() > KMS_MAX_RESPONSE_BYTES {
            return Err(kms_error("response exceeds its size bound".to_string()));
        }
        if !status.is_success() {
            // KMS error bodies carry only an error type and message.
            return Err(kms_error(format!(
                "Decrypt returned {status}: {}",
                String::from_utf8_lossy(&bytes)
            )));
        }
        let decoded: DecryptResponse = serde_json::from_slice(&bytes)
            .map_err(|error| kms_error(format!("response is invalid: {error}")))?;
        if decoded.key_id != self.key_arn {
            return Err(kms_error(format!(
                "Decrypt answered for {}, expected {}",
                decoded.key_id, self.key_arn
            )));
        }
        let plaintext = STANDARD
            .decode(decoded.plaintext)
            .map_err(|error| kms_error(format!("plaintext is not base64: {error}")))?;
        let key_text = std::str::from_utf8(&plaintext)
            .map_err(|_| kms_error("wrapped key is not canonical base64 text".to_string()))?;
        let key = STANDARD
            .decode(key_text)
            .map_err(|_| kms_error("wrapped key is not canonical base64 text".to_string()))?;
        key.try_into().map_err(|key: Vec<u8>| {
            kms_error(format!(
                "wrapped key decodes to {} bytes, expected 32",
                key.len()
            ))
        })
    }
}

fn required(name: &str) -> Result<String, SubjectPrivacyError> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            SubjectPrivacyError::Configuration(format!("{name} is required and must not be blank"))
        })
}

fn kms_error(message: String) -> SubjectPrivacyError {
    SubjectPrivacyError::Configuration(format!("subject authority KMS unwrap failed: {message}"))
}

/// `arn:aws:kms:<region>:<account>:key/<id>` → `<region>`.
pub(crate) fn kms_region_from_arn(arn: &str) -> Result<String, SubjectPrivacyError> {
    let parts = arn.splitn(6, ':').collect::<Vec<_>>();
    match parts.as_slice() {
        ["arn", partition, "kms", region, account, resource]
            if partition.starts_with("aws")
                && !region.is_empty()
                && region.bytes().all(|byte| {
                    byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
                })
                && account.len() == 12
                && account.bytes().all(|byte| byte.is_ascii_digit())
                && resource.starts_with("key/") =>
        {
            Ok((*region).to_string())
        }
        _ => Err(SubjectPrivacyError::Configuration(format!(
            "{KMS_KEY_ARN_ENV} must be a KMS key ARN (arn:aws:kms:<region>:<account>:key/<id>)"
        ))),
    }
}

pub(crate) struct SigningRequest<'a> {
    pub method: &'a str,
    pub path: &'a str,
    /// Every header to sign, including `host` and `x-amz-date`.
    pub headers: &'a [(&'a str, &'a str)],
    pub payload: &'a [u8],
    pub access_key_id: &'a str,
    pub secret_access_key: &'a str,
    pub region: &'a str,
    pub service: &'a str,
    pub amz_date: &'a str,
}

/// AWS Signature Version 4 `Authorization` header for a request without a
/// query string.
pub(crate) fn sigv4_authorization(request: &SigningRequest<'_>) -> String {
    let mut headers = request
        .headers
        .iter()
        .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_string()))
        .collect::<Vec<_>>();
    headers.sort();
    let canonical_headers = headers
        .iter()
        .map(|(name, value)| format!("{name}:{value}\n"))
        .collect::<String>();
    let signed_headers = headers
        .iter()
        .map(|(name, _)| name.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_request = format!(
        "{}\n{}\n\n{}\n{}\n{:x}",
        request.method,
        request.path,
        canonical_headers,
        signed_headers,
        Sha256::digest(request.payload)
    );
    let date = &request.amz_date[..8];
    let scope = format!("{date}/{}/{}/aws4_request", request.region, request.service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{scope}\n{:x}",
        request.amz_date,
        Sha256::digest(canonical_request.as_bytes())
    );
    let mut key = hmac(
        format!("AWS4{}", request.secret_access_key).as_bytes(),
        date.as_bytes(),
    );
    for part in [request.region, request.service, "aws4_request"] {
        key = hmac(&key, part.as_bytes());
    }
    let signature = hmac(&key, string_to_sign.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
        request.access_key_id
    )
}

fn hmac(key: &[u8], message: &[u8]) -> Vec<u8> {
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(key).expect("HMAC accepts keys of any length");
    mac.update(message);
    mac.finalize().into_bytes().to_vec()
}

/// `YYYYMMDDTHHMMSSZ` in UTC.
pub(crate) fn amz_date(now: SystemTime) -> String {
    let seconds = now
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = (seconds / 86_400) as i64;
    let second_of_day = seconds % 86_400;
    // Howard Hinnant's days-to-civil conversion.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        second_of_day / 3_600,
        (second_of_day % 3_600) / 60,
        second_of_day % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    const AKID: &str = "AKIDEXAMPLE";
    const SECRET: &str = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
    const ARN: &str = "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";

    // Vectors from the AWS SigV4 test suite (aws-signing-test-suite/v4).
    #[test]
    fn sigv4_matches_the_aws_get_vanilla_vector() {
        let authorization = sigv4_authorization(&SigningRequest {
            method: "GET",
            path: "/",
            headers: &[
                ("Host", "example.amazonaws.com"),
                ("X-Amz-Date", "20150830T123600Z"),
            ],
            payload: b"",
            access_key_id: AKID,
            secret_access_key: SECRET,
            region: "us-east-1",
            service: "service",
            amz_date: "20150830T123600Z",
        });
        assert_eq!(
            authorization,
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
        );
    }

    #[test]
    fn sigv4_matches_the_aws_post_with_body_vector() {
        let authorization = sigv4_authorization(&SigningRequest {
            method: "POST",
            path: "/",
            headers: &[
                ("Content-Type", "application/x-www-form-urlencoded"),
                ("Host", "example.amazonaws.com"),
                ("Content-Length", "13"),
                (
                    "X-Amz-Content-Sha256",
                    "9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e",
                ),
                ("X-Amz-Date", "20150830T123600Z"),
            ],
            payload: b"Param1=value1",
            access_key_id: AKID,
            secret_access_key: SECRET,
            region: "us-east-1",
            service: "service",
            amz_date: "20150830T123600Z",
        });
        assert!(authorization.ends_with(
            "Signature=d3875051da38690788ef43de4db0d8f280229d82040bfac253562e56c3f20e0b"
        ));
    }

    #[test]
    fn amz_date_is_utc_basic_format() {
        assert_eq!(
            amz_date(UNIX_EPOCH + Duration::from_secs(1_440_938_160)),
            "20150830T123600Z"
        );
        assert_eq!(
            amz_date(UNIX_EPOCH + Duration::from_secs(951_782_400)),
            "20000229T000000Z"
        );
        assert_eq!(amz_date(UNIX_EPOCH), "19700101T000000Z");
    }

    #[test]
    fn region_comes_only_from_a_well_formed_kms_key_arn() {
        assert_eq!(kms_region_from_arn(ARN).unwrap(), "us-east-1");
        for invalid in [
            "",
            "arn:aws:s3:us-east-1:123456789012:key/x",
            "arn:aws:kms::123456789012:key/x",
            "arn:aws:kms:us-east-1:1234:key/x",
            "arn:aws:kms:us-east-1:123456789012:alias/x",
        ] {
            assert!(kms_region_from_arn(invalid).is_err(), "{invalid}");
        }
    }

    /// Serve exactly one HTTP response and hand back the raw request.
    fn fake_kms(status: u16, body: String) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            let mut content_length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse().unwrap();
                }
                head.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut request_body = vec![0; content_length];
            reader.read_exact(&mut request_body).unwrap();
            let mut stream = stream;
            write!(
                stream,
                "HTTP/1.1 {status} X\r\ncontent-type: application/x-amz-json-1.1\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            head + &String::from_utf8(request_body).unwrap()
        });
        (endpoint, handle)
    }

    fn source(endpoint: String) -> KmsWrapKeySource {
        KmsWrapKeySource {
            key_arn: ARN.to_string(),
            region: "us-east-1".to_string(),
            environment: "staging".to_string(),
            ciphertext: STANDARD.encode(b"opaque-ciphertext"),
            access_key_id: AKID.to_string(),
            secret_access_key: SECRET.to_string(),
            endpoint,
        }
    }

    #[tokio::test]
    async fn decrypt_signs_a_context_bound_request_and_returns_the_key() {
        let key = [42_u8; 32];
        let plaintext = STANDARD.encode(STANDARD.encode(key));
        let (endpoint, server) = fake_kms(
            200,
            format!(
                r#"{{"KeyId":"{ARN}","Plaintext":"{plaintext}","EncryptionAlgorithm":"SYMMETRIC_DEFAULT"}}"#
            ),
        );
        assert_eq!(source(endpoint).decrypt().await.unwrap(), key);
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.starts_with("post / http/1.1"));
        assert!(request.contains("x-amz-target: trentservice.decrypt"));
        assert!(request.contains("credential=akidexample/"));
        assert!(request.contains(
            "/us-east-1/kms/aws4_request, signedheaders=content-type;host;x-amz-date;x-amz-target"
        ));
        assert!(request.contains(r#""encryptioncontext":{"fmarch:environment":"staging","fmarch:purpose":"subject-authority-wrap"}"#));
    }

    #[tokio::test]
    async fn decrypt_rejects_wrong_key_errors_and_malformed_plaintext() {
        let other = "arn:aws:kms:us-east-1:123456789012:key/other";
        let cases = [
            (
                200,
                format!(
                    r#"{{"KeyId":"{other}","Plaintext":"{}"}}"#,
                    STANDARD.encode(STANDARD.encode([1_u8; 32]))
                ),
            ),
            (
                400,
                r#"{"__type":"InvalidCiphertextException"}"#.to_string(),
            ),
            (
                200,
                format!(
                    r#"{{"KeyId":"{ARN}","Plaintext":"{}"}}"#,
                    STANDARD.encode(STANDARD.encode([1_u8; 16]))
                ),
            ),
            (
                200,
                format!(
                    r#"{{"KeyId":"{ARN}","Plaintext":"{}"}}"#,
                    STANDARD.encode([1_u8; 32])
                ),
            ),
        ];
        for (status, body) in cases {
            let (endpoint, server) = fake_kms(status, body.clone());
            let result = source(endpoint).decrypt().await;
            server.join().unwrap();
            assert!(
                matches!(result, Err(SubjectPrivacyError::Configuration(ref message)) if message.contains("KMS unwrap failed")),
                "{status} {body}: {result:?}"
            );
        }
    }
}
