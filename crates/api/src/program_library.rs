//! API-facing names for the process-wide embedded content registry.
//!
//! Content discovery, parsing, semantic validation, and content-addressed
//! resolution live in `content_registry`; this module keeps the HTTP adapter's
//! vocabulary compact without reintroducing a filesystem loader.

pub use content_registry::{
    ContentRegistry as ProgramLibrary, ProgramArtifact, ProgramAudience,
    RegistryError as ProgramLibraryError,
};

pub fn load_checked_in_program_library() -> Result<&'static ProgramLibrary, ProgramLibraryError> {
    content_registry::product_registry()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_library_is_content_addressed_and_audience_partitioned() {
        let library = load_checked_in_program_library().unwrap();
        assert_eq!(
            library
                .for_audience(ProgramAudience::Product)
                .map(|artifact| artifact.program_ref.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "host-judged-showcase",
                "opt-in-quest",
                "private-opt-in-circle",
                "raffle",
            ]
        );
        assert_eq!(
            library
                .for_audience(ProgramAudience::Acceptance)
                .map(|artifact| artifact.program_ref.id.as_str())
                .collect::<Vec<_>>(),
            vec!["mash-scale-acceptance"]
        );
    }
}
