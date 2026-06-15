use serde::Deserialize;
use serde_json::Value;

use crate::resolver::{resolve_events, DayPhaseInputs, ResolutionInput};
use crate::state::{StateSnapshot, Submission};
use crate::Pack;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GoldenFixtureError {
    Input(String),
    PackOverride(String),
    Serialize(String),
}

impl std::fmt::Display for GoldenFixtureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GoldenFixtureError::Input(message) => {
                write!(f, "golden input decode error: {message}")
            }
            GoldenFixtureError::PackOverride(message) => {
                write!(f, "golden pack override error: {message}")
            }
            GoldenFixtureError::Serialize(message) => {
                write!(f, "golden event encode error: {message}")
            }
        }
    }
}

impl std::error::Error for GoldenFixtureError {}

#[derive(Deserialize)]
struct GoldenInput {
    phase_id: String,
    state: StateSnapshot,
    submissions: Vec<Submission>,
    #[serde(default)]
    day_phase_inputs: DayPhaseInputs,
    seed: u64,
    #[serde(default)]
    game_id: String,
}

pub fn golden_events_from_input_value(
    input_json: &Value,
    pack: Pack,
    run_id: &str,
) -> Result<Vec<Value>, GoldenFixtureError> {
    let input: GoldenInput = serde_json::from_value(input_json.clone())
        .map_err(|err| GoldenFixtureError::Input(err.to_string()))?;
    let events = resolve_events(ResolutionInput {
        game_id: input.game_id,
        phase_id: input.phase_id,
        run_id: run_id.to_string(),
        state: input.state,
        submissions: input.submissions,
        day_phase_inputs: input.day_phase_inputs,
        pack,
        seed: input.seed,
        logical_time: 0,
    });

    events
        .into_iter()
        .enumerate()
        .map(|(index, event)| {
            let mut value = serde_json::to_value(&event)
                .map_err(|err| GoldenFixtureError::Serialize(err.to_string()))?;
            value
                .as_object_mut()
                .expect("serialized inner event should be an object")
                .insert("index".to_string(), Value::from(index));
            Ok(value)
        })
        .collect()
}

pub fn golden_pack_json_with_overrides(
    pack_json: &Value,
    golden_json: &Value,
) -> Result<Value, GoldenFixtureError> {
    let mut pack_json = pack_json.clone();
    let Some(overrides) = golden_json.get("pack_overrides") else {
        return Ok(pack_json);
    };
    if !overrides.is_object() {
        return Err(GoldenFixtureError::PackOverride(
            "pack_overrides must be a JSON object".to_string(),
        ));
    }
    merge_json(&mut pack_json, overrides);
    Ok(pack_json)
}

fn merge_json(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) => {
            for (key, patch_value) in patch {
                match target.get_mut(key) {
                    Some(target_value) => merge_json(target_value, patch_value),
                    None => {
                        target.insert(key.clone(), patch_value.clone());
                    }
                }
            }
        }
        (target, patch) => {
            *target = patch.clone();
        }
    }
}

pub fn normalize_golden_event(value: &Value) -> Value {
    let mut value = value.clone();
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .map(str::to_string);
    if matches!(kind.as_deref(), Some("DayVoteOutcome") | Some("WinReached")) {
        if let Some(payload) = value.get_mut("payload").and_then(Value::as_object_mut) {
            payload.remove("reason");
        }
    }
    normalize_whole_json_numbers(&mut value);
    value
}

pub fn normalize_golden_events(values: &[Value]) -> Vec<Value> {
    values.iter().map(normalize_golden_event).collect()
}

fn normalize_whole_json_numbers(value: &mut Value) {
    match value {
        Value::Array(values) => {
            for value in values {
                normalize_whole_json_numbers(value);
            }
        }
        Value::Object(map) => {
            for value in map.values_mut() {
                normalize_whole_json_numbers(value);
            }
        }
        Value::Number(number) if number.as_i64().is_none() && number.as_u64().is_none() => {
            if let Some(value_as_f64) = number.as_f64() {
                if value_as_f64.is_finite()
                    && value_as_f64.fract() == 0.0
                    && value_as_f64 >= i64::MIN as f64
                    && value_as_f64 <= i64::MAX as f64
                {
                    *value = Value::from(value_as_f64 as i64);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{golden_pack_json_with_overrides, normalize_golden_event, normalize_golden_events};

    #[test]
    fn normalization_strips_only_known_noncanonical_reason_fields() {
        let event = json!({
            "index": 0,
            "kind": "DayVoteOutcome",
            "payload": {
                "status": "Eliminated",
                "target": "slot_2",
                "reason": "localizable prose"
            }
        });
        assert_eq!(
            normalize_golden_event(&event),
            json!({
                "index": 0,
                "kind": "DayVoteOutcome",
                "payload": {
                    "status": "Eliminated",
                    "target": "slot_2"
                }
            })
        );

        let event = json!({
            "index": 1,
            "kind": "PlayerKilled",
            "payload": {
                "slot_id": "slot_2",
                "reason": "canonical here"
            }
        });
        assert_eq!(
            normalize_golden_event(&event)["payload"]["reason"],
            "canonical here"
        );
    }

    #[test]
    fn normalization_converts_whole_json_floats_to_integers() {
        let events = vec![json!({
            "index": 0.0,
            "kind": "DayVoteOutcome",
            "payload": {
                "count": 3.0,
                "fraction": 1.5
            }
        })];
        assert_eq!(normalize_golden_events(&events)[0]["index"], 0);
        assert_eq!(normalize_golden_events(&events)[0]["payload"]["count"], 3);
        assert_eq!(
            normalize_golden_events(&events)[0]["payload"]["fraction"],
            1.5
        );
    }

    #[test]
    fn pack_overrides_merge_recursively() {
        let pack = json!({
            "name": "base",
            "lover_policy": {
                "enabled": true,
                "suicide_on_lover_death": true
            }
        });
        let golden = json!({
            "pack_overrides": {
                "lover_policy": {
                    "suicide_on_lover_death": false
                }
            }
        });
        let merged = golden_pack_json_with_overrides(&pack, &golden).unwrap();
        assert_eq!(merged["lover_policy"]["enabled"], true);
        assert_eq!(merged["lover_policy"]["suicide_on_lover_death"], false);
    }
}
