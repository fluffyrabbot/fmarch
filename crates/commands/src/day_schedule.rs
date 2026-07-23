//! Pure DayEvent schedule compilation and observation.
//!
//! Wall-clock reads stay outside this module. Callers provide committed phase
//! anchors, phase signals, and one captured observation time; the resulting
//! intents are deterministic values suitable for append-only evidence facts.

use std::collections::{BTreeMap, BTreeSet};

use game_platform::{
    DayEvent, DayEventSchedule, DayEventState, PhaseScope, ProgramTrigger, UnixSeconds,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScheduleOpening {
    Manual,
    Absolute { open_at: i64 },
    RelativeToPhase { phase_id: String, open_offset: i64 },
    OnTrigger { trigger: ProgramTrigger },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScheduleLock {
    Absolute { lock_at: i64 },
    RelativeToPhase { phase_id: String, lock_offset: i64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledSchedule {
    pub opening: ScheduleOpening,
    pub lock: Option<ScheduleLock>,
}

pub fn compile(schedule: &DayEventSchedule) -> CompiledSchedule {
    match schedule {
        DayEventSchedule::Absolute { open_at, lock_at } => CompiledSchedule {
            opening: ScheduleOpening::Absolute {
                open_at: open_at.get(),
            },
            lock: lock_at.map(|lock_at| ScheduleLock::Absolute {
                lock_at: lock_at.get(),
            }),
        },
        DayEventSchedule::RelativeToPhase {
            phase_id,
            open_offset,
            lock_offset,
        } => CompiledSchedule {
            opening: ScheduleOpening::RelativeToPhase {
                phase_id: phase_id.as_str().to_string(),
                open_offset: open_offset.get(),
            },
            lock: lock_offset.map(|lock_offset| ScheduleLock::RelativeToPhase {
                phase_id: phase_id.as_str().to_string(),
                lock_offset: lock_offset.get(),
            }),
        },
        DayEventSchedule::HostOpened => CompiledSchedule {
            opening: ScheduleOpening::Manual,
            lock: None,
        },
        DayEventSchedule::OnTrigger { trigger } => CompiledSchedule {
            opening: ScheduleOpening::OnTrigger {
                trigger: trigger.clone(),
            },
            lock: None,
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PhaseSignalKind {
    Opened,
    Locked,
    Resolved,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct PhaseSignal {
    pub kind: PhaseSignalKind,
    pub phase_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ScheduleTimeline {
    pub phase_opened_at: BTreeMap<String, i64>,
    pub phase_signals: BTreeSet<PhaseSignal>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduleContext {
    pub observed_at: i64,
    pub current_phase_id: String,
    pub current_day_number: Option<u32>,
    pub timeline: ScheduleTimeline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScheduleIntentKind {
    Open,
    Lock,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduleIntent {
    pub kind: ScheduleIntentKind,
    pub due_at: i64,
    pub source: String,
}

/// Evaluate one projected event at one captured observation time.
///
/// When an observation crosses both boundaries, Open precedes Lock. Terminal
/// events produce no intents, which makes a committed manual cancellation win
/// over all later scheduler observations.
pub fn evaluate(
    event: &DayEvent,
    state: DayEventState,
    context: &ScheduleContext,
) -> Vec<ScheduleIntent> {
    if matches!(state, DayEventState::Resolved | DayEventState::Cancelled) {
        return Vec::new();
    }

    let schedule = compile(&event.schedule);
    let mut intents = Vec::new();
    let opening = opening_due(&schedule.opening, context);
    let may_open = state == DayEventState::Scheduled
        && opening.is_some()
        && phase_scope_allows_open(&event.phase_scope, context);
    if let Some(intent) = opening.filter(|_| may_open) {
        intents.push(intent);
    }

    let will_be_open = state == DayEventState::Open || may_open;
    if will_be_open {
        let schedule_lock = schedule
            .lock
            .as_ref()
            .and_then(|lock| lock_due(lock, context));
        let scope_lock = explicit_scope_lock(&event.phase_scope, context);
        if let Some(intent) = earliest_lock(schedule_lock, scope_lock) {
            intents.push(intent);
        }
    }
    intents
}

fn opening_due(opening: &ScheduleOpening, context: &ScheduleContext) -> Option<ScheduleIntent> {
    let (due_at, source) = match opening {
        ScheduleOpening::Manual => return None,
        ScheduleOpening::Absolute { open_at } => (*open_at, "absolute".to_string()),
        ScheduleOpening::RelativeToPhase {
            phase_id,
            open_offset,
        } => {
            if context.current_phase_id != *phase_id {
                return None;
            }
            (
                context
                    .timeline
                    .phase_opened_at
                    .get(phase_id)?
                    .checked_add(*open_offset)?,
                format!("relative_to_phase:{phase_id}"),
            )
        }
        ScheduleOpening::OnTrigger { trigger } => {
            if trigger_phase_id(trigger) != context.current_phase_id
                || !trigger_seen(trigger, &context.timeline.phase_signals)
            {
                return None;
            }
            (context.observed_at, trigger_source(trigger))
        }
    };
    (context.observed_at >= due_at).then_some(ScheduleIntent {
        kind: ScheduleIntentKind::Open,
        due_at,
        source,
    })
}

fn lock_due(lock: &ScheduleLock, context: &ScheduleContext) -> Option<ScheduleIntent> {
    let (due_at, source) = match lock {
        ScheduleLock::Absolute { lock_at } => (*lock_at, "absolute".to_string()),
        ScheduleLock::RelativeToPhase {
            phase_id,
            lock_offset,
        } => (
            context
                .timeline
                .phase_opened_at
                .get(phase_id)?
                .checked_add(*lock_offset)?,
            format!("relative_to_phase:{phase_id}"),
        ),
    };
    (context.observed_at >= due_at).then_some(ScheduleIntent {
        kind: ScheduleIntentKind::Lock,
        due_at,
        source,
    })
}

fn explicit_scope_lock(scope: &PhaseScope, context: &ScheduleContext) -> Option<ScheduleIntent> {
    let PhaseScope::ExplicitWindow { closes_at, .. } = scope else {
        return None;
    };
    (context.observed_at >= closes_at.get()).then_some(ScheduleIntent {
        kind: ScheduleIntentKind::Lock,
        due_at: closes_at.get(),
        source: "explicit_window".to_string(),
    })
}

fn earliest_lock(
    left: Option<ScheduleIntent>,
    right: Option<ScheduleIntent>,
) -> Option<ScheduleIntent> {
    match (left, right) {
        (Some(left), Some(right)) if right.due_at < left.due_at => Some(right),
        (Some(left), _) => Some(left),
        (None, right) => right,
    }
}

fn phase_scope_allows_open(scope: &PhaseScope, context: &ScheduleContext) -> bool {
    match scope {
        PhaseScope::DuringDay { number } => context.current_day_number == Some(*number),
        PhaseScope::AnyRunning => true,
        PhaseScope::ExplicitWindow {
            opens_at,
            closes_at,
        } => context.observed_at >= opens_at.get() && context.observed_at < closes_at.get(),
    }
}

fn trigger_seen(trigger: &ProgramTrigger, signals: &BTreeSet<PhaseSignal>) -> bool {
    let (kind, phase_id) = match trigger {
        ProgramTrigger::PhaseOpened { phase_id } => (PhaseSignalKind::Opened, phase_id),
        ProgramTrigger::PhaseLocked { phase_id } => (PhaseSignalKind::Locked, phase_id),
        ProgramTrigger::PhaseResolved { phase_id } => (PhaseSignalKind::Resolved, phase_id),
    };
    signals.contains(&PhaseSignal {
        kind,
        phase_id: phase_id.as_str().to_string(),
    })
}

fn trigger_source(trigger: &ProgramTrigger) -> String {
    match trigger {
        ProgramTrigger::PhaseOpened { phase_id } => {
            format!("trigger:phase_opened:{phase_id}")
        }
        ProgramTrigger::PhaseLocked { phase_id } => {
            format!("trigger:phase_locked:{phase_id}")
        }
        ProgramTrigger::PhaseResolved { phase_id } => {
            format!("trigger:phase_resolved:{phase_id}")
        }
    }
}

fn trigger_phase_id(trigger: &ProgramTrigger) -> &str {
    match trigger {
        ProgramTrigger::PhaseOpened { phase_id }
        | ProgramTrigger::PhaseLocked { phase_id }
        | ProgramTrigger::PhaseResolved { phase_id } => phase_id.as_str(),
    }
}

pub fn unix_seconds(value: i64) -> UnixSeconds {
    UnixSeconds::new(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use game_platform::{
        ChannelId, DayEventId, DayEventResolutionMode, DurationSeconds, EventChannelPolicy,
        NarrativeTemplates, ParticipantFilter, ParticipationLimits, ParticipationMode,
        ParticipationSpec, PhaseId, ProgramId, RecipientSelector, RewardBinding,
        RewardEffectTemplate, RewardKey, Tag, TemplateKey,
    };

    fn event(schedule: DayEventSchedule) -> DayEvent {
        DayEvent {
            id: DayEventId::new("event").unwrap(),
            program_id: ProgramId::new("program").unwrap(),
            template_key: TemplateKey::new("template").unwrap(),
            phase_scope: PhaseScope::AnyRunning,
            schedule,
            participation: ParticipationSpec {
                who: ParticipantFilter::AliveSlots,
                mode: ParticipationMode::OptIn,
                limits: ParticipationLimits {
                    minimum: 0,
                    maximum: None,
                },
            },
            state: DayEventState::Scheduled,
            resolution: DayEventResolutionMode::HostDecision,
            rewards: vec![RewardBinding {
                reward_key: RewardKey::new("reward").unwrap(),
                display_name_theme_key: TemplateKey::new("reward.label").unwrap(),
                effects: vec![RewardEffectTemplate {
                    recipient: RecipientSelector::Winner,
                    operation: game_platform::EffectOperationTemplate::Mark {
                        effect: Tag::new("bomb").unwrap(),
                    },
                }],
            }],
            narrative: NarrativeTemplates {
                opened: None,
                locked: None,
                resolved: None,
                cancelled: None,
            },
            channel_policy: EventChannelPolicy {
                allowed_channels: vec![ChannelId::new("main").unwrap()],
            },
        }
    }

    fn context(observed_at: i64) -> ScheduleContext {
        ScheduleContext {
            observed_at,
            current_phase_id: "D01".to_string(),
            current_day_number: Some(1),
            timeline: ScheduleTimeline::default(),
        }
    }

    #[test]
    fn absolute_boundaries_open_then_lock_once_due() {
        let event = event(DayEventSchedule::Absolute {
            open_at: unix_seconds(100),
            lock_at: Some(unix_seconds(200)),
        });
        assert!(evaluate(&event, DayEventState::Scheduled, &context(99)).is_empty());
        assert_eq!(
            evaluate(&event, DayEventState::Scheduled, &context(200))
                .iter()
                .map(|intent| intent.kind)
                .collect::<Vec<_>>(),
            [ScheduleIntentKind::Open, ScheduleIntentKind::Lock]
        );
    }

    #[test]
    fn relative_schedule_requires_an_explicit_phase_open_anchor() {
        let event = event(DayEventSchedule::RelativeToPhase {
            phase_id: PhaseId::new("D01").unwrap(),
            open_offset: DurationSeconds::new(10).unwrap(),
            lock_offset: Some(DurationSeconds::new(20).unwrap()),
        });
        assert!(evaluate(&event, DayEventState::Scheduled, &context(120)).is_empty());
        let mut context = context(120);
        context.timeline.phase_opened_at.insert("D01".into(), 100);
        assert_eq!(
            evaluate(&event, DayEventState::Scheduled, &context)
                .iter()
                .map(|intent| intent.due_at)
                .collect::<Vec<_>>(),
            [110, 120]
        );
    }

    #[test]
    fn trigger_and_terminal_cancellation_are_deterministic() {
        let trigger = ProgramTrigger::PhaseResolved {
            phase_id: PhaseId::new("D01").unwrap(),
        };
        let event = event(DayEventSchedule::OnTrigger {
            trigger: trigger.clone(),
        });
        let mut context = context(300);
        context.timeline.phase_signals.insert(PhaseSignal {
            kind: PhaseSignalKind::Resolved,
            phase_id: "D01".into(),
        });
        assert_eq!(
            evaluate(&event, DayEventState::Scheduled, &context)[0].source,
            "trigger:phase_resolved:D01"
        );
        assert!(evaluate(&event, DayEventState::Cancelled, &context).is_empty());
    }
}
