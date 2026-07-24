//! Pure DayEvent narrative validation and rendering.
//!
//! Templates are immutable program content. Rendering uses only binding values
//! captured from committed lifecycle facts and their rebuildable projections.

use crate::{ModelError, NarrativeLifecycle, NarrativeTemplate, ProgramContentHash};

const SUPPORTED_BINDINGS: &[&str] = &[
    "event_id",
    "event_template",
    "participant_count",
    "participants",
    "winners",
    "rewards",
    "cancellation_reason",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NarrativeBindings {
    pub event_id: String,
    pub event_template: String,
    pub participants: Vec<String>,
    pub winners: Vec<String>,
    pub rewards: Vec<String>,
    pub cancellation_reason: Option<String>,
}

pub fn validate_bindings(template: &NarrativeTemplate) -> Result<(), ModelError> {
    for binding in binding_names(&template.body) {
        if !SUPPORTED_BINDINGS.contains(&binding.as_str()) {
            return Err(ModelError::UnknownNarrativeBinding {
                template: template.key.clone(),
                binding,
            });
        }
    }
    Ok(())
}

pub fn render(body: &str, bindings: &NarrativeBindings) -> String {
    let participants = bindings.participants.join(", ");
    let winners = bindings.winners.join(", ");
    let rewards = bindings.rewards.join(", ");
    let participant_count = bindings.participants.len().to_string();
    [
        ("event_id", bindings.event_id.as_str()),
        ("event_template", bindings.event_template.as_str()),
        ("participant_count", participant_count.as_str()),
        ("participants", participants.as_str()),
        ("winners", winners.as_str()),
        ("rewards", rewards.as_str()),
        (
            "cancellation_reason",
            bindings.cancellation_reason.as_deref().unwrap_or(""),
        ),
    ]
    .into_iter()
    .fold(body.to_string(), |rendered, (name, value)| {
        rendered.replace(&format!("{{{{{name}}}}}"), value)
    })
}

pub fn receipt_id(
    event_id: &str,
    lifecycle: NarrativeLifecycle,
    source_seq: i64,
    template_hash: &ProgramContentHash,
) -> String {
    let mut input = Vec::new();
    input.extend_from_slice(b"fmarch-day-event-narrative:v1\0");
    input.extend_from_slice(event_id.as_bytes());
    input.push(0);
    input.extend_from_slice(lifecycle.as_str().as_bytes());
    input.push(0);
    input.extend_from_slice(&source_seq.to_le_bytes());
    input.extend_from_slice(template_hash.as_str().as_bytes());
    blake3::hash(&input).to_hex().to_string()
}

fn binding_names(body: &str) -> Vec<String> {
    let mut remaining = body;
    let mut bindings = Vec::new();
    while let Some(open) = remaining.find("{{") {
        remaining = &remaining[open + 2..];
        let Some(close) = remaining.find("}}") else {
            bindings.push(remaining.trim().to_string());
            break;
        };
        bindings.push(remaining[..close].trim().to_string());
        remaining = &remaining[close + 2..];
    }
    bindings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ChannelId, NarrativeTemplate, TemplateKey};

    #[test]
    fn templates_reject_unknown_bindings_and_render_captured_values() {
        let invalid = NarrativeTemplate {
            key: TemplateKey::new("event.bad").unwrap(),
            channel_id: ChannelId::new("main").unwrap(),
            body: "Hello {{mystery}}".to_string(),
        };
        assert!(matches!(
            validate_bindings(&invalid),
            Err(ModelError::UnknownNarrativeBinding { .. })
        ));

        let rendered = render(
            "{{event_id}} closed with {{participant_count}} entrants: {{participants}}; winners: {{winners}}; rewards: {{rewards}}",
            &NarrativeBindings {
                event_id: "raffle-d1".to_string(),
                event_template: "theme.raffle".to_string(),
                participants: vec!["slot_1".to_string(), "slot_2".to_string()],
                winners: vec!["slot_2".to_string()],
                rewards: vec!["cookie".to_string()],
                cancellation_reason: None,
            },
        );
        assert_eq!(
            rendered,
            "raffle-d1 closed with 2 entrants: slot_1, slot_2; winners: slot_2; rewards: cookie"
        );
    }
}
