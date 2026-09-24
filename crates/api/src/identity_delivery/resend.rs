//! Resend adapter: delivers identity credentials as email through Resend's
//! `POST /emails` API instead of the provider-neutral http-json relay.
//!
//! Resend cannot echo attempt-bound results, so exactly-once rests on its
//! idempotency key: every attempt of one delivery sends the same key and the
//! same payload, and Resend replays the original acceptance for 24 hours.
//! Anything short of an acceptance or a documented rejection stays uncertain.

use super::{
    identity_delivery_configuration_fingerprint, parse_retry_after_seconds,
    read_bounded_delivery_response, IdentityDeliveryAttempt, IdentityDeliveryFailureCode,
    IdentityDeliveryFuture, IdentityDeliveryGateway, IdentityDeliveryHttpTimeouts,
    IdentityDeliveryKind, IdentityDeliveryOutcome, IdentityDeliveryProviderProbeFuture,
    IdentityDeliveryProviderProbeOutcome,
};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const RESEND_ADAPTER_PROTOCOL: &str = "resend-emails-v1+idempotency-key-v1+validation-probe-v1";
const MAX_RECIPIENT_BYTES: usize = 320;

pub struct ResendIdentityDeliveryGateway {
    provider_id: String,
    endpoint: Url,
    api_key: String,
    sender: String,
    link_origin: Url,
    configuration_fingerprint: String,
    client: Client,
    timeouts: IdentityDeliveryHttpTimeouts,
}

#[derive(Debug, Serialize)]
struct ResendEmailRequest<'a> {
    from: &'a str,
    to: [&'a str; 1],
    subject: &'static str,
    text: String,
}

#[derive(Debug, Deserialize)]
struct ResendEmailAccepted {
    id: String,
}

impl ResendIdentityDeliveryGateway {
    pub fn configured(
        provider_id: impl Into<String>,
        endpoint: Url,
        api_key: String,
        sender: String,
        link_origin: Url,
        timeouts: IdentityDeliveryHttpTimeouts,
    ) -> Result<Self, String> {
        let provider_id = provider_id.into();
        if provider_id.trim() != provider_id || provider_id.is_empty() || provider_id.len() > 128 {
            return Err("identity delivery provider id must be 1..=128 unpadded bytes".to_string());
        }
        require_plain_https(&endpoint, "Resend endpoint")?;
        require_plain_https(&link_origin, "identity delivery link origin")?;
        if link_origin.path() != "/" {
            return Err("identity delivery link origin must be a bare origin".to_string());
        }
        if api_key.trim().is_empty() || api_key.trim() != api_key {
            return Err("Resend API key must be non-blank and unpadded".to_string());
        }
        if sender.trim() != sender
            || !sender.contains('@')
            || sender.chars().any(|character| character.is_control())
        {
            return Err(
                "identity delivery sender must be an unpadded single-line address".to_string(),
            );
        }
        let client = Client::builder()
            .connect_timeout(timeouts.connect)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("Resend HTTP client is invalid: {error}"))?;
        // The sender and link origin shape every delivered message, so they
        // belong to the durable generation fingerprint with the endpoint.
        let protocol = format!(
            "{RESEND_ADAPTER_PROTOCOL}\nsender={sender}\nlinks={}",
            link_origin.as_str()
        );
        let configuration_fingerprint =
            identity_delivery_configuration_fingerprint(&protocol, &endpoint);
        Ok(Self {
            provider_id,
            endpoint,
            api_key,
            sender,
            link_origin,
            configuration_fingerprint,
            client,
            timeouts,
        })
    }

    pub fn total_timeout(&self) -> std::time::Duration {
        self.timeouts.total()
    }

    fn message(&self, attempt: &IdentityDeliveryAttempt, credential: &str) -> (&'static str, String) {
        let link = |path: &str, credential_in_link: bool| {
            let mut url = self.link_origin.join(path).expect("static path joins an origin");
            {
                let mut query = url.query_pairs_mut();
                query.append_pair("account", attempt.account_id.as_str());
                if credential_in_link {
                    query.append_pair("invite", credential);
                }
            }
            url.to_string()
        };
        match attempt.kind {
            IdentityDeliveryKind::CommunityInvitation => (
                "Your fmarch community invitation",
                format!(
                    "You have been invited to join the fmarch community.\n\n\
                     Accept the invitation and sign in:\n{}\n\n\
                     This link is personal and works once. If you did not expect it, ignore this email.\n",
                    link("/auth/invite", true)
                ),
            ),
            IdentityDeliveryKind::Invite => (
                "Your fmarch game invitation",
                format!(
                    "You have been invited to a game on fmarch.\n\n\
                     Accept the invitation and sign in:\n{}\n\n\
                     This link is personal and works once. If you did not expect it, ignore this email.\n",
                    link("/auth/game-invite", true)
                ),
            ),
            IdentityDeliveryKind::Recovery => (
                "Your fmarch account recovery code",
                format!(
                    "Someone asked to recover this fmarch account.\n\n\
                     Recovery code: {credential}\n\n\
                     Enter it at:\n{}\n\n\
                     If you did not ask for this, ignore this email; the code expires on its own.\n",
                    link("/auth/account/recovery", false)
                ),
            ),
        }
    }

    async fn deliver_resend(&self, attempt: &IdentityDeliveryAttempt) -> IdentityDeliveryOutcome {
        match tokio::time::timeout(self.timeouts.total, self.deliver_with_deadlines(attempt)).await
        {
            Ok(outcome) => outcome,
            Err(_) => uncertain(None),
        }
    }

    async fn deliver_with_deadlines(
        &self,
        attempt: &IdentityDeliveryAttempt,
    ) -> IdentityDeliveryOutcome {
        let Some(credential) = attempt.credential_material.as_deref() else {
            return IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::CredentialUnavailable,
            );
        };
        let recipient = attempt.account_id.as_str();
        if !deliverable_address(recipient) {
            // Nothing was sent: a non-address account id can never be mailed.
            return IdentityDeliveryOutcome::PermanentFailure(
                IdentityDeliveryFailureCode::RecipientRejected,
            );
        }
        let (subject, text) = self.message(attempt, credential);
        let request = ResendEmailRequest {
            from: self.sender.as_str(),
            to: [recipient],
            subject,
            text,
        };
        let sent = self
            .client
            .post(self.endpoint.clone())
            .bearer_auth(self.api_key.as_str())
            .header("Idempotency-Key", idempotency_key(attempt.delivery_id))
            .json(&request)
            .send();
        let response = match tokio::time::timeout(self.timeouts.response, sent).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) | Err(_) => return uncertain(None),
        };
        let status = response.status();
        let retry_after_seconds = parse_retry_after_seconds(response.headers());
        match status {
            status if status.is_success() => {
                if response
                    .content_length()
                    .is_some_and(|length| length > self.timeouts.max_response_bytes as u64)
                {
                    return uncertain(None);
                }
                let body = match tokio::time::timeout(
                    self.timeouts.body,
                    read_bounded_delivery_response(response, self.timeouts.max_response_bytes),
                )
                .await
                {
                    Ok(Some(body)) => body,
                    Ok(None) | Err(_) => return uncertain(None),
                };
                match serde_json::from_slice::<ResendEmailAccepted>(&body) {
                    Ok(accepted) if !accepted.id.trim().is_empty() => {
                        IdentityDeliveryOutcome::Delivered {
                            provider_receipt_id: accepted.id,
                        }
                    }
                    _ => uncertain(None),
                }
            }
            // Resend rejects before accepting: invalid recipient, an
            // unverified sending domain, or a test-mode recipient restriction.
            StatusCode::BAD_REQUEST | StatusCode::FORBIDDEN | StatusCode::UNPROCESSABLE_ENTITY => {
                IdentityDeliveryOutcome::PermanentFailure(
                    IdentityDeliveryFailureCode::RecipientRejected,
                )
            }
            // A rejected key suspends the generation until a probe succeeds.
            StatusCode::UNAUTHORIZED => IdentityDeliveryOutcome::RetryableFailure(
                IdentityDeliveryFailureCode::ProviderUnavailable,
            ),
            StatusCode::TOO_MANY_REQUESTS => match retry_after_seconds {
                Some(retry_after_seconds) => IdentityDeliveryOutcome::RetryableFailureAfter {
                    code: IdentityDeliveryFailureCode::ProviderUnavailable,
                    retry_after_seconds,
                },
                None => IdentityDeliveryOutcome::RetryableFailure(
                    IdentityDeliveryFailureCode::ProviderUnavailable,
                ),
            },
            // Conflicting idempotent requests, server errors, and anything
            // an intermediary synthesizes may still have been accepted.
            _ => uncertain(retry_after_seconds),
        }
    }

    async fn probe_resend(&self) -> IdentityDeliveryProviderProbeOutcome {
        match tokio::time::timeout(self.timeouts.total, self.probe_with_deadlines()).await {
            Ok(outcome) => outcome,
            Err(_) => IdentityDeliveryProviderProbeOutcome::Unavailable,
        }
    }

    /// An empty email request authenticates the key and is then rejected as
    /// invalid, so a validation error proves reachability and a usable key
    /// without sending anything. Every other answer keeps the suspension.
    async fn probe_with_deadlines(&self) -> IdentityDeliveryProviderProbeOutcome {
        let sent = self
            .client
            .post(self.endpoint.clone())
            .bearer_auth(self.api_key.as_str())
            .json(&serde_json::json!({}))
            .send();
        match tokio::time::timeout(self.timeouts.response, sent).await {
            Ok(Ok(response)) if response.status() == StatusCode::UNPROCESSABLE_ENTITY => {
                IdentityDeliveryProviderProbeOutcome::Available
            }
            _ => IdentityDeliveryProviderProbeOutcome::Unavailable,
        }
    }
}

impl IdentityDeliveryGateway for ResendIdentityDeliveryGateway {
    fn provider_id(&self) -> &str {
        self.provider_id.as_str()
    }

    fn configuration_fingerprint(&self) -> &str {
        self.configuration_fingerprint.as_str()
    }

    fn deliver<'a>(&'a self, attempt: &'a IdentityDeliveryAttempt) -> IdentityDeliveryFuture<'a> {
        Box::pin(self.deliver_resend(attempt))
    }

    fn probe<'a>(&'a self, _probe_token: Uuid) -> IdentityDeliveryProviderProbeFuture<'a> {
        Box::pin(self.probe_resend())
    }
}

fn uncertain(retry_after_seconds: Option<i64>) -> IdentityDeliveryOutcome {
    IdentityDeliveryOutcome::UncertainFailure {
        code: IdentityDeliveryFailureCode::ProviderUnavailable,
        retry_after_seconds,
    }
}

fn idempotency_key(delivery_id: Uuid) -> String {
    format!("fmarch-identity-delivery/{delivery_id}")
}

fn deliverable_address(value: &str) -> bool {
    let Some((local, domain)) = value.rsplit_once('@') else {
        return false;
    };
    value.len() <= MAX_RECIPIENT_BYTES
        && !local.is_empty()
        && domain.contains('.')
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
}

fn require_plain_https(url: &Url, label: &str) -> Result<(), String> {
    let local_host = matches!(url.host_str(), Some("127.0.0.1" | "localhost"));
    if url.scheme() != "https" && !local_host {
        return Err(format!("{label} must use https outside localhost"));
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(format!(
            "{label} must not contain credentials, query, or fragment"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use principal::PrincipalId;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    fn timeouts() -> IdentityDeliveryHttpTimeouts {
        IdentityDeliveryHttpTimeouts::new(
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(1),
            Duration::from_secs(4),
            64 * 1024,
        )
        .unwrap()
    }

    fn attempt(kind: IdentityDeliveryKind, account_id: &str) -> IdentityDeliveryAttempt {
        IdentityDeliveryAttempt {
            delivery_id: Uuid::from_u128(7),
            attempt_token: Uuid::from_u128(8),
            lease_expires_at: 4_102_444_795,
            clock_skew_margin_seconds: 5,
            kind,
            account_id: account_id.to_string(),
            principal_id: PrincipalId::fixture("member_a"),
            credential_hash: "hash".to_string(),
            credential_expires_at: 4_102_444_800,
            credential_material: Some("fmci_secret".to_string()),
            attempt_number: 1,
        }
    }

    type Seen = Arc<Mutex<Vec<(Option<String>, Option<String>, serde_json::Value)>>>;

    async fn fake_resend(status: StatusCode, body: serde_json::Value) -> (Url, Seen) {
        let seen: Seen = Arc::default();
        let recorded = seen.clone();
        let app = axum::Router::new().route(
            "/emails",
            axum::routing::post(
                move |headers: axum::http::HeaderMap, axum::Json(payload): axum::Json<serde_json::Value>| {
                    let recorded = recorded.clone();
                    let body = body.clone();
                    async move {
                        let header = |name: &str| {
                            headers
                                .get(name)
                                .and_then(|value| value.to_str().ok())
                                .map(str::to_string)
                        };
                        recorded.lock().unwrap().push((
                            header("authorization"),
                            header("idempotency-key"),
                            payload,
                        ));
                        (status, axum::Json(body))
                    }
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (Url::parse(&format!("http://{address}/emails")).unwrap(), seen)
    }

    fn gateway(endpoint: Url) -> ResendIdentityDeliveryGateway {
        ResendIdentityDeliveryGateway::configured(
            "staging-resend-v1",
            endpoint,
            "re_fixture_key".to_string(),
            "fmarch staging <invites@example.org>".to_string(),
            Url::parse("https://frontend.example.org/").unwrap(),
            timeouts(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn community_invitation_is_mailed_once_per_delivery_with_a_redeemable_link() {
        let (endpoint, seen) =
            fake_resend(StatusCode::OK, serde_json::json!({ "id": "resend-email-1" })).await;
        let gateway = gateway(endpoint);
        let delivery = attempt(IdentityDeliveryKind::CommunityInvitation, "member@example.org");
        assert_eq!(
            gateway.deliver(&delivery).await,
            IdentityDeliveryOutcome::Delivered {
                provider_receipt_id: "resend-email-1".to_string()
            }
        );
        assert_eq!(
            gateway.deliver(&delivery).await,
            IdentityDeliveryOutcome::Delivered {
                provider_receipt_id: "resend-email-1".to_string()
            }
        );
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        let (authorization, idempotency, payload) = &seen[0];
        assert_eq!(authorization.as_deref(), Some("Bearer re_fixture_key"));
        assert_eq!(
            idempotency.as_deref(),
            Some(format!("fmarch-identity-delivery/{}", Uuid::from_u128(7)).as_str())
        );
        assert_eq!(seen[1].1, seen[0].1, "every attempt reuses the delivery key");
        assert_eq!(seen[1].2, seen[0].2, "every attempt resends the identical payload");
        assert_eq!(payload["to"], serde_json::json!(["member@example.org"]));
        assert_eq!(payload["from"], "fmarch staging <invites@example.org>");
        let text = payload["text"].as_str().unwrap();
        assert!(text.contains(
            "https://frontend.example.org/auth/invite?account=member%40example.org&invite=fmci_secret"
        ));
    }

    #[tokio::test]
    async fn recovery_mail_carries_the_code_but_never_puts_it_in_a_link() {
        let (endpoint, seen) =
            fake_resend(StatusCode::OK, serde_json::json!({ "id": "resend-email-2" })).await;
        let gateway = gateway(endpoint);
        gateway
            .deliver(&attempt(IdentityDeliveryKind::Recovery, "member@example.org"))
            .await;
        let text = seen.lock().unwrap()[0].2["text"].as_str().unwrap().to_string();
        assert!(text.contains("Recovery code: fmci_secret"));
        assert!(text.contains("https://frontend.example.org/auth/account/recovery?account=member%40example.org\n"));
        assert!(!text.contains("invite="));
    }

    #[tokio::test]
    async fn resend_responses_map_to_certain_and_uncertain_outcomes() {
        let cases = [
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                IdentityDeliveryOutcome::PermanentFailure(IdentityDeliveryFailureCode::RecipientRejected),
            ),
            (
                StatusCode::FORBIDDEN,
                IdentityDeliveryOutcome::PermanentFailure(IdentityDeliveryFailureCode::RecipientRejected),
            ),
            (
                StatusCode::UNAUTHORIZED,
                IdentityDeliveryOutcome::RetryableFailure(IdentityDeliveryFailureCode::ProviderUnavailable),
            ),
            (
                StatusCode::TOO_MANY_REQUESTS,
                IdentityDeliveryOutcome::RetryableFailure(IdentityDeliveryFailureCode::ProviderUnavailable),
            ),
            (StatusCode::CONFLICT, uncertain(None)),
            (StatusCode::INTERNAL_SERVER_ERROR, uncertain(None)),
        ];
        for (status, expected) in cases {
            let (endpoint, _) =
                fake_resend(status, serde_json::json!({ "name": "fixture" })).await;
            assert_eq!(
                gateway(endpoint)
                    .deliver(&attempt(IdentityDeliveryKind::CommunityInvitation, "member@example.org"))
                    .await,
                expected,
                "{status}"
            );
        }
        let (endpoint, _) = fake_resend(StatusCode::OK, serde_json::json!({ "id": " " })).await;
        assert_eq!(
            gateway(endpoint)
                .deliver(&attempt(IdentityDeliveryKind::CommunityInvitation, "member@example.org"))
                .await,
            uncertain(None),
            "an acceptance without a receipt id is not proof of delivery"
        );
    }

    #[tokio::test]
    async fn undeliverable_account_ids_are_rejected_without_contacting_resend() {
        let (endpoint, seen) =
            fake_resend(StatusCode::OK, serde_json::json!({ "id": "unused" })).await;
        let gateway = gateway(endpoint);
        for account in ["classic-login", "a@b", "has space@example.org", "x@example.org\r\nBcc: y@z.org"] {
            assert_eq!(
                gateway.deliver(&attempt(IdentityDeliveryKind::Invite, account)).await,
                IdentityDeliveryOutcome::PermanentFailure(IdentityDeliveryFailureCode::RecipientRejected),
                "{account:?}"
            );
        }
        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn probe_accepts_only_a_validation_rejection_of_an_empty_request() {
        for (status, expected) in [
            (StatusCode::UNPROCESSABLE_ENTITY, IdentityDeliveryProviderProbeOutcome::Available),
            (StatusCode::UNAUTHORIZED, IdentityDeliveryProviderProbeOutcome::Unavailable),
            (StatusCode::OK, IdentityDeliveryProviderProbeOutcome::Unavailable),
            (StatusCode::BAD_GATEWAY, IdentityDeliveryProviderProbeOutcome::Unavailable),
        ] {
            let (endpoint, seen) = fake_resend(status, serde_json::json!({})).await;
            assert_eq!(gateway(endpoint).probe(Uuid::from_u128(1)).await, expected, "{status}");
            assert_eq!(seen.lock().unwrap()[0].2, serde_json::json!({}));
        }
    }

    #[test]
    fn configuration_rejects_unsafe_targets_and_fingerprints_message_shape() {
        let endpoint = Url::parse("https://api.resend.com/emails").unwrap();
        let origin = Url::parse("https://frontend.example.org/").unwrap();
        let build = |endpoint: &Url, sender: &str, origin: &Url| {
            ResendIdentityDeliveryGateway::configured(
                "staging-resend-v1",
                endpoint.clone(),
                "re_fixture_key".to_string(),
                sender.to_string(),
                origin.clone(),
                timeouts(),
            )
        };
        assert!(build(&Url::parse("http://api.resend.com/emails").unwrap(), "a@b.org", &origin).is_err());
        assert!(build(&endpoint, "a@b.org", &Url::parse("https://f.example.org/app").unwrap()).is_err());
        assert!(build(&endpoint, "a@b.org\nBcc: c@d.org", &origin).is_err());
        assert!(build(&endpoint, "no-address", &origin).is_err());
        let first = build(&endpoint, "a@b.org", &origin).unwrap();
        let other_sender = build(&endpoint, "c@b.org", &origin).unwrap();
        assert_ne!(
            first.configuration_fingerprint(),
            other_sender.configuration_fingerprint()
        );
    }
}
