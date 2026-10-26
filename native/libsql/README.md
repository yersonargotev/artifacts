# Prepare the local native client

The workspace uses SDK `@libsql/client` 0.18.0 without changes. Its local `libsql` 0.5.29 dependency resets the original native statement after an operation fails. The source patch covers failed transaction controls and failed row reads. It preserves the original errors, Cargo.lock, encryption features, wrapper API, and SDK Config.

Use Node 24, Rust and Cargo 1.93.0, clang, Git, tar, and Python 3 with venv support. Install the Rust toolchain with `rustup toolchain install 1.93.0 --profile minimal` if needed. Preparation installs CMake 3.31.6 into `.native/tools` through its own Python environment. It does not install a global tool.

Run these commands before the first dependency installation.

```sh
node scripts/prepare-native.mjs
pnpm install --frozen-lockfile
```

Preparation downloads the source and wrapper archives named in `inputs.json`, verifies their SHA-256 values, applies `native-reset.patch`, and checks the exact patched source. It runs `cargo build --locked --release` with the upstream features. macOS builds retain deployment target 11.0. Generated sources, tools, packages, and binaries stay in the ignored `.native` directory.

The generated `.native/libsql` package contains the official wrapper files, declarations, license, and a sibling `index.node`. Only the two native loader functions and their unused imports change. The loaders reject an incompatible host and have no registry fallback. Ordinary pnpm resolution selects this package for both SDK entrypoints. Nothing edits installed or hardlinked dependency files.

Run `pnpm prepare:native --check` to verify the cached inputs, target, and output hashes. A changed or damaged output fails validation. Run `pnpm prepare:native --rebuild` to replace an owned generated output from the pinned sources. `provenance.json` records the actual build tools, host, N-API requirement, inputs, and file hashes. A locked dependency graph does not promise byte-identical builds.

The supported build hosts are macOS arm64 and Linux x64 with glibc. A Linux manifest records the build host's glibc version. It does not claim compatibility with older, untested glibc versions. Build the private native-fixed distribution on the intended deployment platform. Other native targets remain unverified.

The default seven-package portable distribution keeps the upstream registry native dependency and its inherited statement-retention limitation. The optional native-fixed profile bundles the corrected graph for private server consumers. It needs no compiler or installation script on the consumer. The public CLI's credential database uses Node's built-in SQLite and does not depend on this server-native graph.

The patch does not change active-transaction `client.close()` behavior, successful abandoned iterators, or replica statement reset. Replica runtime behavior remains unverified. No application retry, busy timeout, journal mode, reconnect policy, or SQL cleanup execution changes.
