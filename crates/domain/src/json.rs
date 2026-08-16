//! Closed JSON atoms for persist-side maps that used to be `serde_json::Value`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

const JSON_NULL: JsonAtom = JsonAtom::Null;

/// Recursive JSON value used by traces, info results, and similar persist maps.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonAtom {
    #[default]
    Null,
    Bool(bool),
    Number(serde_json::Number),
    String(String),
    Array(Vec<JsonAtom>),
    Object(BTreeMap<String, JsonAtom>),
}

impl JsonAtom {
    pub fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(value) => Some(value),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Bool(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Number(value) => value.as_f64(),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Self::Number(value) => value.as_i64(),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[JsonAtom]> {
        match self {
            Self::Array(values) => Some(values),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&BTreeMap<String, JsonAtom>> {
        match self {
            Self::Object(values) => Some(values),
            _ => None,
        }
    }

    pub fn get(&self, key: &str) -> Option<&JsonAtom> {
        self.as_object().and_then(|values| values.get(key))
    }

    /// Look up an object key. Missing keys are [`JsonAtom::Null`].
    pub fn at(&self, key: impl AsRef<str>) -> &JsonAtom {
        self.get(key.as_ref()).unwrap_or(&JSON_NULL)
    }

    /// Look up an array index. Out-of-range indexes are [`JsonAtom::Null`].
    pub fn nth(&self, index: usize) -> &JsonAtom {
        self.as_array()
            .and_then(|values| values.get(index))
            .unwrap_or(&JSON_NULL)
    }

    pub(crate) fn insert(&mut self, key: impl Into<String>, value: Self) {
        match self {
            Self::Object(values) => {
                values.insert(key.into(), value);
            }
            other => panic!("cannot insert into {other:?}"),
        }
    }
}

impl From<Value> for JsonAtom {
    fn from(value: Value) -> Self {
        match value {
            Value::Null => Self::Null,
            Value::Bool(value) => Self::Bool(value),
            Value::Number(value) => Self::Number(value),
            Value::String(value) => Self::String(value),
            Value::Array(values) => Self::Array(values.into_iter().map(Self::from).collect()),
            Value::Object(values) => Self::Object(
                values
                    .into_iter()
                    .map(|(key, value)| (key, Self::from(value)))
                    .collect(),
            ),
        }
    }
}

impl From<JsonAtom> for Value {
    fn from(value: JsonAtom) -> Self {
        match value {
            JsonAtom::Null => Value::Null,
            JsonAtom::Bool(value) => Value::Bool(value),
            JsonAtom::Number(value) => Value::Number(value),
            JsonAtom::String(value) => Value::String(value),
            JsonAtom::Array(values) => Value::Array(values.into_iter().map(Value::from).collect()),
            JsonAtom::Object(values) => Value::Object(
                values
                    .into_iter()
                    .map(|(key, value)| (key, Value::from(value)))
                    .collect(),
            ),
        }
    }
}

impl PartialEq<str> for JsonAtom {
    fn eq(&self, other: &str) -> bool {
        self.as_str() == Some(other)
    }
}

impl PartialEq<&str> for JsonAtom {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == Some(*other)
    }
}

impl PartialEq<String> for JsonAtom {
    fn eq(&self, other: &String) -> bool {
        self.as_str() == Some(other.as_str())
    }
}

impl PartialEq<bool> for JsonAtom {
    fn eq(&self, other: &bool) -> bool {
        self.as_bool() == Some(*other)
    }
}

impl PartialEq<i32> for JsonAtom {
    fn eq(&self, other: &i32) -> bool {
        self.as_i64() == Some(i64::from(*other))
    }
}

impl PartialEq<i64> for JsonAtom {
    fn eq(&self, other: &i64) -> bool {
        self.as_i64() == Some(*other)
    }
}

impl PartialEq<u32> for JsonAtom {
    fn eq(&self, other: &u32) -> bool {
        self.as_i64() == Some(i64::from(*other))
    }
}

impl PartialEq<usize> for JsonAtom {
    fn eq(&self, other: &usize) -> bool {
        self.as_i64() == Some(*other as i64)
    }
}

impl PartialEq<f64> for JsonAtom {
    fn eq(&self, other: &f64) -> bool {
        self.as_f64() == Some(*other)
    }
}

macro_rules! impl_ref_partial_eq {
    ($($ty:ty),+ $(,)?) => {
        $(
            impl PartialEq<$ty> for &JsonAtom {
                fn eq(&self, other: &$ty) -> bool {
                    (*self).eq(other)
                }
            }
        )+
    };
}

impl_ref_partial_eq!(str, String, bool, i32, i64, u32, usize, f64, Value);

impl PartialEq<Value> for JsonAtom {
    fn eq(&self, other: &Value) -> bool {
        match (self, other) {
            (Self::Null, Value::Null) => true,
            (Self::Bool(left), Value::Bool(right)) => left == right,
            (Self::Number(left), Value::Number(right)) => left == right,
            (Self::String(left), Value::String(right)) => left == right,
            (Self::Array(left), Value::Array(right)) => {
                left.len() == right.len()
                    && left.iter().zip(right).all(|(left, right)| left == right)
            }
            (Self::Object(left), Value::Object(right)) => {
                left.len() == right.len()
                    && left
                        .iter()
                        .all(|(key, value)| right.get(key).is_some_and(|other| value == other))
            }
            _ => false,
        }
    }
}

/// Build a persist JSON atom from a `serde_json::json!` literal.
macro_rules! json_atom {
    ($($token:tt)*) => {
        $crate::json::JsonAtom::from(::serde_json::json!($($token)*))
    };
}

pub(crate) use json_atom;
