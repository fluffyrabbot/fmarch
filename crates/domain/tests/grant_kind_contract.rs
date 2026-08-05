use domain::GrantKind;

#[test]
fn grant_kind_preserves_domain_pascal_case_and_accepts_platform_aliases() {
    let cases = [
        (GrantKind::ExtraAction, "ExtraAction", "extra_action"),
        (GrantKind::Item, "Item", "item"),
        (GrantKind::VoteWeight, "VoteWeight", "vote_weight"),
    ];

    for (kind, domain_name, platform_name) in cases {
        assert_eq!(
            serde_json::to_string(&kind).unwrap(),
            format!("\"{domain_name}\"")
        );
        assert_eq!(
            serde_json::from_str::<GrantKind>(&format!("\"{domain_name}\"")).unwrap(),
            kind
        );
        assert_eq!(
            serde_json::from_str::<GrantKind>(&format!("\"{platform_name}\"")).unwrap(),
            kind
        );
    }
}
