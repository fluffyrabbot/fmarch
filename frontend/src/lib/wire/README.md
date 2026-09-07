# Wire TypeScript contract

`types.ts` is **generated**. Do not edit it by hand.

Regenerate both checked-in copies (crate + SPA) with:

```sh
python3 scripts/with-heavy-build-lock.py -- cargo run -p wire --bin export_types -- --write
```

Verify with:

```sh
python3 scripts/with-heavy-build-lock.py -- cargo run -p wire --bin export_types -- --check
```
