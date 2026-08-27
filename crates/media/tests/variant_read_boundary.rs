fn assert_ordered(section: &str, contracts: &[&str], boundary: &str) {
    let mut previous = 0;
    for (index, contract) in contracts.iter().enumerate() {
        let search_start = usize::from(index > 0) * (previous + 1);
        let position = section[search_start..]
            .find(contract)
            .map(|offset| search_start + offset)
            .unwrap_or_else(|| panic!("{boundary} lost contract: {contract}"));
        if index > 0 {
            assert!(
                position > previous,
                "{boundary} ordering changed at {contract}"
            );
        }
        previous = position;
    }
}

#[test]
fn attached_variant_reads_have_one_immutable_descriptor_owning_boundary() {
    // Embed the audited production source. Runtime filesystem lookup via
    // CARGO_MANIFEST_DIR makes this structural contract depend on where Cargo
    // happened to compile the test, which is not stable across cache restores.
    let source = include_str!("../src/variants.rs");
    let production = source
        .split("#[cfg(test)]")
        .next()
        .expect("production variant source");

    for request_contract in [
        "struct AttachedVariantReadRequest<'a> {",
        "directory: &'a Dir",
        "name: &'a str",
        "file: File",
        "logical_path: &'a Path",
        "max_len: u64",
        "id: ContentId",
        "label: &'a str",
    ] {
        assert!(
            production.contains(request_contract),
            "missing attached-read request contract: {request_contract}"
        );
    }
    assert!(!production.contains("pub struct AttachedVariantReadRequest"));
    assert_eq!(
        production
            .matches("read_capped_attached(AttachedVariantReadRequest {")
            .count(),
        3,
        "manifest, persisted-member, and snapshot-member reads must construct the request directly"
    );
    assert!(
        !production.contains("clippy::too_many_arguments"),
        "the typed request must remove the attached-read lint allowance"
    );

    let open_snapshot_start = production
        .find("fn open_variant_snapshot(")
        .expect("snapshot open owner");
    let verify_snapshot_start = production[open_snapshot_start..]
        .find("fn verify_variant_snapshot_attached(")
        .map(|offset| open_snapshot_start + offset)
        .expect("snapshot verification owner");
    let manifest_read = &production[open_snapshot_start..verify_snapshot_start];
    assert_ordered(
        manifest_read,
        &[
            "open_regular_file(&recipe_directory, MANIFEST_NAME, &manifest_path)?",
            "read_capped_attached(AttachedVariantReadRequest {",
            "directory: &recipe_directory",
            "name: MANIFEST_NAME",
            "file: manifest_file.try_clone()?",
            "logical_path: &manifest_path",
            "max_len: MANIFEST_MAX_BYTES",
            "label: \"manifest\"",
            "parse_manifest(id, &manifest_bytes)?",
        ],
        "manifest attached read",
    );
    assert!(manifest_read.contains(
        "max_len: MANIFEST_MAX_BYTES,\n            id,\n            label: \"manifest\""
    ));

    let persist_member_start = production
        .find("fn persist_variant_member(")
        .expect("persisted member owner");
    let snapshot_member_start = production[persist_member_start..]
        .find("fn read_variant_member_from_snapshot(")
        .map(|offset| persist_member_start + offset)
        .expect("snapshot member owner");
    let persisted_member = &production[persist_member_start..snapshot_member_start];
    assert_ordered(
        persisted_member,
        &[
            "persist_named_bytes(",
            "open_regular_file(format_directory, record.key.kind.component(), &logical_path)?",
            "read_capped_attached(AttachedVariantReadRequest {",
            "directory: format_directory",
            "name: record.key.kind.component()",
            "file: reopened",
            "logical_path: &logical_path",
            "max_len: record.encoded_len",
            "label: \"variant\"",
            "verify_member_bytes(id, record, &bytes)?",
            "self.verify_format_attached(",
            "self.verify_recipe_attached(",
        ],
        "persisted member attached read",
    );
    assert!(persisted_member
        .contains("max_len: record.encoded_len,\n            id,\n            label: \"variant\""));

    let remove_manifest_start = production[snapshot_member_start..]
        .find("fn remove_variant_manifest(")
        .map(|offset| snapshot_member_start + offset)
        .expect("snapshot member boundary end");
    let snapshot_member = &production[snapshot_member_start..remove_manifest_start];
    assert_ordered(
        snapshot_member,
        &[
            "record.encoded_len > limits.max_member_encoded_bytes as u64",
            "check_variant_dimensions(",
            "open_format_directory(",
            "open_regular_file(",
            "read_capped_attached(AttachedVariantReadRequest {",
            "directory: &format_directory",
            "name: record.key.kind.component()",
            "file,",
            "logical_path: &logical_path",
            "max_len: record.encoded_len",
            "label: \"variant\"",
            "verify_member_bytes(id, record, &bytes)?",
            "self.verify_format_attached(",
            "self.verify_recipe_attached(",
        ],
        "snapshot member attached read",
    );
    assert!(snapshot_member
        .contains("max_len: record.encoded_len,\n            id,\n            label: \"variant\""));

    let read_start = production
        .find("fn read_capped_attached(")
        .expect("attached-read boundary");
    let corrupt_start = production[read_start..]
        .find("pub(crate) fn corrupt_set(")
        .map(|offset| read_start + offset)
        .expect("attached-read boundary end");
    let read = &production[read_start..corrupt_start];
    assert!(read.starts_with("fn read_capped_attached(request: AttachedVariantReadRequest<'_>)"));
    assert_ordered(
        read,
        &[
            "let AttachedVariantReadRequest {",
            "directory,",
            "name,",
            "mut file,",
            "logical_path,",
            "max_len,",
            "id,",
            "label,",
            "verify_attached_entry(directory, name, &file, logical_path)?",
            "let metadata = file.metadata()?",
            "metadata.len() > max_len",
            "{label} exceeds its declared cap",
            "let mut bytes = Vec::new()",
            ".try_reserve_exact(metadata.len() as usize)",
            "{label} allocation failed",
            "Read::by_ref(&mut file)",
            ".take(max_len.saturating_add(1))",
            ".read_to_end(&mut bytes)?",
            "bytes.len() as u64 > max_len",
            "{label} grew beyond its cap",
            "harden_and_sync_file(&file)?",
            "sync_dir(directory)?",
            "verify_attached_entry(directory, name, &file, logical_path)?",
            "Ok(bytes)",
        ],
        "attached-read primitive",
    );

    let lookup_start = production
        .find("fn lookup_variant_snapshot_with_hook<F>(")
        .expect("snapshot lookup owner");
    let lookup_end = production[lookup_start..]
        .find("fn open_variant_snapshot(")
        .map(|offset| lookup_start + offset)
        .expect("snapshot lookup boundary end");
    assert_ordered(
        &production[lookup_start..lookup_end],
        &[
            "self.read_variant_member_from_snapshot(",
            "hook(VariantLookupStage::MembersVerified)?",
            "self.verify_variant_snapshot_attached(id, &snapshot)?",
            "Ok(Some(VerifiedVariantSnapshot {",
        ],
        "final snapshot attachment",
    );
}
