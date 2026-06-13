#[test]
fn generated_typescript_contract_is_current() {
    let expected = include_str!("../generated/types.ts");
    let actual = wire::typescript::render();
    assert_eq!(
        actual, expected,
        "wire TypeScript contract drifted; run `cargo run -p wire --bin export_types > crates/wire/generated/types.ts`"
    );
}
