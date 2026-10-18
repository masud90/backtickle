//! Guards for the security policy and the permission skeleton.
//! They read the shipped configuration files, so a careless edit fails `cargo test`.

use backtickle_lib::windows::{CANVAS_DARK, CANVAS_LIGHT, TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y};
use serde_json::Value;
use std::collections::BTreeSet;

const TAURI_CONF: &str = include_str!("../tauri.conf.json");
const MAIN_CAPABILITY: &str = include_str!("../capabilities/main.json");
const PREFERENCES_CAPABILITY: &str = include_str!("../capabilities/preferences.json");
const BUILD_RS: &str = include_str!("../build.rs");
const LIB_RS: &str = include_str!("../src/lib.rs");
const CARGO_TOML: &str = include_str!("../Cargo.toml");
const PACKAGE_JSON: &str = include_str!("../../package.json");
const TOKENS_CSS: &str = include_str!("../../src/styles/tokens.css");
const INDEX_HTML: &str = include_str!("../../index.html");
const PREFERENCES_HTML: &str = include_str!("../../preferences.html");

/// The only non-local origins the web view may reach, and only for the IPC and asset protocols.
const ALLOWED_LOCAL_ORIGINS: [&str; 2] = ["http://ipc.localhost", "http://asset.localhost"];

fn json(text: &str) -> Value {
    serde_json::from_str(text).expect("valid JSON")
}

fn csp(kind: &str) -> serde_json::Map<String, Value> {
    json(TAURI_CONF)["app"]["security"][kind]
        .as_object()
        .unwrap_or_else(|| panic!("app.security.{kind} must be a directive map"))
        .clone()
}

fn sources<'a>(csp: &'a serde_json::Map<String, Value>, directive: &str) -> Vec<&'a str> {
    csp.get(directive)
        .unwrap_or_else(|| panic!("CSP is missing {directive}"))
        .as_str()
        .expect("directive value is a string")
        .split_whitespace()
        .collect()
}

#[test]
fn versions_agree_across_cargo_tauri_conf_and_package_json() {
    let cargo = env!("CARGO_PKG_VERSION");
    let conf = json(TAURI_CONF);
    let package = json(PACKAGE_JSON);

    assert_eq!(
        conf["version"], cargo,
        "tauri.conf.json version differs from Cargo.toml"
    );
    assert_eq!(
        package["version"], cargo,
        "package.json version differs from Cargo.toml"
    );
}

#[test]
fn app_identity_and_single_main_window() {
    let conf = json(TAURI_CONF);

    assert_eq!(conf["productName"], "Backtickle");
    assert_eq!(conf["identifier"], "app.backtickle.desktop");
    assert_eq!(conf["app"]["withGlobalTauri"], false);

    let windows = conf["app"]["windows"].as_array().expect("windows array");
    assert_eq!(
        windows.len(),
        1,
        "only the main window is declared; Preferences is created on demand"
    );
    assert_eq!(windows[0]["label"], "main");
}

#[test]
fn production_csp_is_strict() {
    let csp = csp("csp");

    for directive in ["default-src", "script-src"] {
        assert_eq!(
            sources(&csp, directive),
            ["'self'"],
            "{directive} must be 'self' only"
        );
    }
    for directive in ["object-src", "base-uri", "frame-src", "form-action"] {
        assert_eq!(
            sources(&csp, directive),
            ["'none'"],
            "{directive} must be 'none'"
        );
    }
    for (directive, value) in &csp {
        let list: Vec<&str> = value.as_str().expect("string").split_whitespace().collect();
        assert!(
            !list.contains(&"'unsafe-eval'"),
            "{directive} must not allow unsafe-eval"
        );
        if directive == "script-src" {
            assert!(
                !list.contains(&"'unsafe-inline'"),
                "script-src must not allow inline scripts"
            );
        }
    }
}

#[test]
fn only_images_may_load_from_the_web() {
    for kind in ["csp", "devCsp"] {
        for (directive, value) in &csp(kind) {
            if directive == "img-src" {
                continue; // https images are allowed, as the plan's "load remote images" option
            }
            for source in value.as_str().expect("string").split_whitespace() {
                let remote_scheme = ["http:", "https:", "ws:", "wss:"]
                    .iter()
                    .any(|scheme| source.starts_with(scheme));
                if !remote_scheme {
                    continue;
                }
                let is_local_dev_server = kind == "devCsp"
                    && ["http://localhost:1420", "ws://localhost:1420"].contains(&source);
                assert!(
                    ALLOWED_LOCAL_ORIGINS.contains(&source) || is_local_dev_server,
                    "{kind} {directive} allows a remote source: {source}"
                );
            }
        }
    }
}

#[test]
fn dev_csp_only_adds_the_local_vite_server() {
    let production = csp("csp");
    let development = csp("devCsp");

    assert_eq!(
        production.keys().collect::<Vec<_>>(),
        development.keys().collect::<Vec<_>>(),
        "csp and devCsp must have the same directives"
    );
    for directive in production.keys().filter(|d| *d != "connect-src") {
        assert_eq!(
            sources(&production, directive),
            sources(&development, directive),
            "{directive} differs between csp and devCsp"
        );
    }
    let mut expected = sources(&production, "connect-src");
    expected.extend(["http://localhost:1420", "ws://localhost:1420"]);
    assert_eq!(sources(&development, "connect-src"), expected);
}

#[test]
fn main_window_capability_is_narrow() {
    let capability = json(MAIN_CAPABILITY);

    assert_eq!(capability["windows"], serde_json::json!(["main", "doc-*"]));

    let permissions: Vec<&str> = capability["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .map(|p| p.as_str().expect("permission identifiers are strings"))
        .collect();
    assert!(!permissions.is_empty());
    for permission in permissions {
        assert!(
            !permission.starts_with("fs:"),
            "no fs plugin: file access goes through narrowly scoped commands, found {permission}"
        );
        assert!(
            !permission.contains('*'),
            "no wildcard permissions: {permission}"
        );
    }
}

// ---- permissions ---------------------------------------------------------------------------

fn permissions(capability: &str) -> Vec<String> {
    json(capability)["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .map(|p| {
            p.as_str()
                .expect("permission identifiers are strings")
                .to_string()
        })
        .collect()
}

/// The command names listed in build.rs, such as "read_text_file".
fn manifest_commands() -> BTreeSet<String> {
    let start = BUILD_RS
        .find(".commands(&[")
        .expect("build.rs lists the commands");
    let list = &BUILD_RS[start..];
    let end = list.find("])").expect("the command list ends");
    list[..end]
        .split('"')
        .enumerate()
        .filter(|(index, _)| index % 2 == 1) // the text between quotes
        .map(|(_, name)| name.to_string())
        .collect()
}

/// "allow-read-text-file" -> "read_text_file"
fn command_of(permission: &str) -> Option<String> {
    permission
        .strip_prefix("allow-")
        .map(|name| name.replace('-', "_"))
}

#[test]
fn no_window_gets_a_plugin_permission_only_core_and_our_own_commands() {
    // The web view reaches files, dialogs and windows only through our own commands. A plugin
    // permission (fs:, dialog:, shell:, opener:, ...) would give it a generic route.
    for (name, capability) in [
        ("main", MAIN_CAPABILITY),
        ("preferences", PREFERENCES_CAPABILITY),
    ] {
        for permission in permissions(capability) {
            assert!(
                permission.starts_with("core:") || permission.starts_with("allow-"),
                "{name} capability grants a plugin permission: {permission}"
            );
            assert!(!permission.contains('*'), "{name}: wildcard {permission}");
        }
    }
}

#[test]
fn windows_cannot_create_windows_or_webviews() {
    for capability in [MAIN_CAPABILITY, PREFERENCES_CAPABILITY] {
        for permission in permissions(capability) {
            // Our own file commands (Phase 3) create files and folders, not windows.
            let creates_files = matches!(
                permission.as_str(),
                "allow-create-file" | "allow-create-folder"
            );
            assert!(
                (creates_files || !permission.contains("create"))
                    && !permission.contains("webview"),
                "Preferences is created from Rust, not by the web view: {permission}"
            );
        }
    }
}

#[test]
fn preferences_capability_belongs_to_the_preferences_window_and_is_small() {
    let capability = json(PREFERENCES_CAPABILITY);

    assert_eq!(capability["windows"], serde_json::json!(["preferences"]));
    let granted: BTreeSet<String> = permissions(PREFERENCES_CAPABILITY).into_iter().collect();
    let expected: BTreeSet<String> = [
        "core:window:allow-start-dragging",
        "core:window:allow-internal-toggle-maximize",
        // Phase 4 (D09): close itself, hear settings changes, read and update the
        // settings, show Pandoc, choose a Pandoc and a default folder.
        "core:window:allow-close",
        "core:window:allow-destroy",
        "core:event:allow-listen",
        "core:event:allow-unlisten",
        "allow-app-version",
        "allow-perf-mark",
        "allow-get-settings",
        "allow-update-settings",
        "allow-pandoc-info",
        "allow-choose-pandoc",
        "allow-choose-default-folder",
        "allow-default-markdown-app",
        "allow-make-default-markdown-app",
    ]
    .iter()
    .map(|p| p.to_string())
    .collect();
    assert_eq!(
        granted, expected,
        "the Preferences window gets the minimum it needs"
    );
}

#[test]
fn only_the_main_window_may_answer_the_close_and_quit_protocol() {
    // ack_close, finish_close and cancel_close decide whether the app quits, so the window that
    // is asked (the main one) is the only one that may answer.
    let preferences = permissions(PREFERENCES_CAPABILITY);
    for command in [
        "allow-ack-close",
        "allow-finish-close",
        "allow-cancel-close",
    ] {
        assert!(
            permissions(MAIN_CAPABILITY).iter().any(|p| p == command),
            "main must be allowed {command}"
        );
        assert!(
            !preferences.iter().any(|p| p == command),
            "Preferences must not be allowed {command}"
        );
    }
}

#[test]
fn only_the_main_window_may_read_files_or_choose_them() {
    let preferences = permissions(PREFERENCES_CAPABILITY);
    for command in [
        "allow-pick-file",
        "allow-read-text-file",
        "allow-launch-options",
        // Phase 1: everything that reads, saves, reveals or opens a file or a link.
        "allow-open-dialog",
        "allow-save-dialog",
        "allow-read-document",
        "allow-save-document",
        "allow-document-context",
        "allow-reveal-in-finder",
        "allow-open-external",
        "allow-open-linked-document",
        "allow-reveal-linked-file",
        "allow-resolve-image",
        "allow-open-recent",
        "allow-take-pending-open-files",
    ] {
        assert!(
            permissions(MAIN_CAPABILITY).iter().any(|p| p == command),
            "main must be allowed {command}"
        );
        assert!(
            !preferences.iter().any(|p| p == command),
            "Preferences must not be allowed {command}"
        );
    }
}

#[test]
fn every_command_in_build_rs_is_granted_somewhere_and_every_grant_names_a_command() {
    let commands = manifest_commands();
    assert!(commands.contains("read_text_file") && commands.contains("pick_file"));

    let granted: BTreeSet<String> = permissions(MAIN_CAPABILITY)
        .iter()
        .chain(permissions(PREFERENCES_CAPABILITY).iter())
        .filter_map(|permission| command_of(permission))
        .collect();

    assert_eq!(
        granted, commands,
        "build.rs and the capability files must list the same commands"
    );
}

#[test]
fn the_main_window_can_start_dragging_and_listen_for_edit_commands() {
    let main = permissions(MAIN_CAPABILITY);
    for needed in [
        "core:window:allow-start-dragging",
        "core:event:allow-listen",
        "core:event:allow-unlisten",
    ] {
        assert!(main.iter().any(|p| p == needed), "main needs {needed}");
    }
    // It may listen but not emit events to other windows.
    assert!(
        !main
            .iter()
            .any(|p| p == "core:event:default" || p == "core:event:allow-emit")
    );
}

// ---- hardening and window setup -------------------------------------------------------------

#[test]
fn the_prototype_is_frozen_in_every_web_view() {
    assert_eq!(json(TAURI_CONF)["app"]["security"]["freezePrototype"], true);
}

#[test]
fn the_traffic_lights_are_centered_in_the_44px_title_bar() {
    let position = &json(TAURI_CONF)["app"]["windows"][0]["trafficLightPosition"];

    assert_eq!(position["x"], TRAFFIC_LIGHT_X);
    assert_eq!(position["y"], TRAFFIC_LIGHT_Y);
    // Measured on macOS 27: tao puts the center of the 14 px buttons `y - 2` px from the top.
    assert_eq!(TRAFFIC_LIGHT_Y - 2.0, 44.0 / 2.0);
    assert_eq!(TRAFFIC_LIGHT_X, 14.0, "the mock's left inset");
}

fn hex(color: tauri::window::Color) -> String {
    format!("#{:02x}{:02x}{:02x}", color.0, color.1, color.2)
}

/// The value of `--wd-canvas` in the first block (light) or in the dark blocks of tokens.css.
fn canvas_token(dark: bool) -> String {
    let marker = if dark {
        "@media (prefers-color-scheme: dark)"
    } else {
        ":root {"
    };
    let start = TOKENS_CSS.find(marker).expect("block in tokens.css");
    let rest = &TOKENS_CSS[start..];
    let at = rest.find("--wd-canvas:").expect("canvas token");
    rest[at + "--wd-canvas:".len()..]
        .trim_start()
        .chars()
        .take_while(|c| *c != ';')
        .collect()
}

#[test]
fn the_launch_background_is_the_canvas_token_in_light_and_dark() {
    assert_eq!(hex(CANVAS_LIGHT), canvas_token(false));
    assert_eq!(hex(CANVAS_DARK), canvas_token(true));
}

#[test]
fn entry_pages_have_no_inline_styles_or_scripts() {
    // Tauri rewrites the content security policy when it finds an inline <style> or <script> in
    // a page: it adds a nonce, and a nonce makes browsers ignore 'unsafe-inline'. That silently
    // blocked every style CodeMirror injects, in the built app only. Keep the pages free of
    // inline code; the background before the first paint comes from the window color (Rust).
    for (name, page) in [
        ("index.html", INDEX_HTML),
        ("preferences.html", PREFERENCES_HTML),
    ] {
        assert!(!page.contains("<style"), "{name} has an inline <style>");
        for script in page.split("<script").skip(1) {
            let tag = script.split('>').next().unwrap_or_default();
            assert!(tag.contains("src="), "{name} has an inline <script>");
        }
        assert!(
            page.contains(r#"<meta name="color-scheme" content="light dark" />"#),
            "{name} declares both color schemes"
        );
    }
}

#[test]
fn style_elements_do_not_depend_on_tauri_nonces_and_style_attributes_are_blocked() {
    for kind in ["csp", "devCsp"] {
        let csp = csp(kind);
        assert_eq!(
            sources(&csp, "style-src-elem"),
            ["'self'", "'unsafe-inline'"],
            "{kind}: style elements (CodeMirror injects some) must not rely on style-src, which Tauri may extend with a nonce"
        );
        assert_eq!(
            sources(&csp, "style-src-attr"),
            ["'none'"],
            "{kind}: inline style attributes are not used and stay blocked"
        );
    }
}

// ---- Phase 1: asset protocol, file associations, registered commands ---------------------------

#[test]
fn the_asset_protocol_is_enabled_with_an_empty_static_scope() {
    // Images are made reachable one file at a time at runtime (src/assets.rs, resolve_image).
    // A path or a glob in this scope would make whole folders reachable from the web view.
    let protocol = &json(TAURI_CONF)["app"]["security"]["assetProtocol"];

    assert_eq!(protocol["enable"], true);
    assert_eq!(protocol["scope"], serde_json::json!([]));
}

#[test]
fn the_tauri_crate_has_the_asset_protocol_feature_the_configuration_needs() {
    // tauri-build refuses a build where the two disagree; this says it in one place.
    assert!(
        CARGO_TOML.contains("protocol-asset"),
        "Cargo.toml must enable tauri's protocol-asset feature"
    );
}

fn associations() -> Vec<Value> {
    json(TAURI_CONF)["bundle"]["fileAssociations"]
        .as_array()
        .expect("bundle.fileAssociations")
        .clone()
}

fn extensions_with_rank(rank: &str) -> BTreeSet<String> {
    associations()
        .iter()
        .filter(|association| association["rank"] == rank)
        .flat_map(|association| {
            association["ext"]
                .as_array()
                .expect("ext list")
                .iter()
                .map(|ext| ext.as_str().expect("ext is a string").to_string())
                .collect::<Vec<_>>()
        })
        .collect()
}

#[test]
fn markdown_files_can_have_backtickle_as_their_default_app() {
    let default = extensions_with_rank("Default");

    let expected: BTreeSet<String> = ["md", "markdown", "mdown", "mkd", "mkdn"]
        .iter()
        .map(|ext| ext.to_string())
        .collect();
    assert_eq!(default, expected);
}

#[test]
fn mdx_quarto_and_r_markdown_are_only_an_alternative_so_other_apps_stay_the_default() {
    let alternate = extensions_with_rank("Alternate");

    let expected: BTreeSet<String> = ["mdx", "qmd", "rmd", "Rmd"]
        .iter()
        .map(|ext| ext.to_string())
        .collect();
    assert_eq!(alternate, expected);
}

#[test]
fn every_association_is_an_editor_and_nothing_else_is_associated() {
    let all: BTreeSet<String> = extensions_with_rank("Default")
        .union(&extensions_with_rank("Alternate"))
        .cloned()
        .collect();
    for association in associations() {
        assert_eq!(association["role"], "Editor", "{association}");
        assert!(
            association.get("exportedType").is_none(),
            "no type is exported: the extensions use the system's type or a dynamic one"
        );
    }
    assert_eq!(all.len(), 9, "{all:?}");
    for not_ours in ["txt", "mmd", "pdf", "html", "csv"] {
        assert!(!all.contains(not_ours), "{not_ours} must not be associated");
    }
}

#[test]
fn the_markdown_associations_use_the_system_markdown_type_where_it_exists() {
    // `mdls -name kMDItemContentType` on a .md and a .markdown file says
    // net.daringfireball.markdown on macOS; the other extensions have only dynamic types and
    // are matched by extension.
    let system = associations()
        .into_iter()
        .find(|association| {
            association["ext"]
                .as_array()
                .is_some_and(|ext| ext.iter().any(|e| e == "md"))
        })
        .expect("an association for md");

    assert_eq!(
        system["contentTypes"],
        serde_json::json!(["net.daringfireball.markdown"])
    );
}

/// The commands in the `generate_handler!` list of lib.rs, such as "read_document".
fn registered_commands() -> BTreeSet<String> {
    let start = LIB_RS
        .find("generate_handler![")
        .expect("lib.rs registers the commands");
    let list = &LIB_RS[start..];
    let end = list.find("])").expect("the handler list ends");
    list[..end]
        .split([',', '\n', '['])
        .map(str::trim)
        .filter_map(|entry| {
            entry
                .strip_prefix("commands::")
                .or_else(|| entry.strip_prefix("bridge::"))
        })
        .map(str::to_string)
        .collect()
}

#[test]
fn every_registered_command_is_listed_in_build_rs_and_the_other_way_round() {
    let registered = registered_commands();
    let listed = manifest_commands();

    assert!(registered.contains("read_document") && registered.contains("ping"));
    assert_eq!(
        registered, listed,
        "lib.rs (generate_handler) and build.rs must name the same commands"
    );
}

#[test]
fn the_opener_plugin_is_used_only_through_its_functions_and_is_never_registered() {
    // Registering the plugin would add its commands (open_url, open_path, reveal_item_in_dir),
    // which a capability could then hand to the web view. External links and Reveal in Finder
    // go through our own commands, which check the URL scheme and the grants first.
    assert!(!LIB_RS.contains("tauri_plugin_opener::init"));
    assert!(
        permissions(MAIN_CAPABILITY)
            .iter()
            .chain(permissions(PREFERENCES_CAPABILITY).iter())
            .all(|permission| !permission.starts_with("opener:")),
        "no opener permission for any window"
    );
}

#[test]
fn the_dialog_plugin_is_registered_but_no_window_may_use_it_directly() {
    assert!(LIB_RS.contains("tauri_plugin_dialog::init"));
    for permission in permissions(MAIN_CAPABILITY)
        .iter()
        .chain(permissions(PREFERENCES_CAPABILITY).iter())
    {
        assert!(!permission.starts_with("dialog:"), "{permission}");
    }
}

#[test]
fn the_csp_still_allows_the_asset_protocol_only_for_images() {
    for kind in ["csp", "devCsp"] {
        let csp = csp(kind);
        let images = sources(&csp, "img-src");
        assert!(images.contains(&"asset:") && images.contains(&"http://asset.localhost"));
        for directive in [
            "default-src",
            "script-src",
            "style-src",
            "connect-src",
            "font-src",
        ] {
            let list = sources(&csp, directive);
            assert!(
                !list.contains(&"asset:") && !list.contains(&"http://asset.localhost"),
                "{kind} {directive} must not load from the asset protocol"
            );
        }
    }
}

#[test]
fn b31_no_rust_code_starts_a_process_and_no_window_may_ask_for_one() {
    // Phase 2 reads files a document names (bibliographies, includes, embeds) but never runs
    // anything; since Phase 3 only `pandoc.rs` may start a process: no `std::process::Command`, no shell plugin, no shell or process permission.
    let source_folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut checked = 0;
    for entry in std::fs::read_dir(&source_folder).expect("src folder") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        // Word export starts Pandoc from `pandoc.rs` and from nowhere else.
        if path.file_name().and_then(|n| n.to_str()) == Some("pandoc.rs") {
            checked += 1;
            continue;
        }
        let text = std::fs::read_to_string(&path).expect("source file");
        for forbidden in [
            "process::Command",
            "Command::new",
            "tauri_plugin_shell",
            "tauri_plugin_process",
        ] {
            assert!(
                !text.contains(forbidden),
                "{} uses {forbidden}",
                path.display()
            );
        }
        checked += 1;
    }
    assert!(checked > 20, "the scan found the source files");

    for dependency in ["tauri-plugin-shell", "tauri-plugin-process"] {
        assert!(!CARGO_TOML.contains(dependency), "{dependency}");
    }
    for permission in permissions(MAIN_CAPABILITY)
        .iter()
        .chain(permissions(PREFERENCES_CAPABILITY).iter())
    {
        assert!(
            !permission.starts_with("shell:") && !permission.starts_with("process:"),
            "{permission}"
        );
    }
    // The commands of this phase are registered and none of them is a launcher.
    let registered = registered_commands();
    for name in ["read_linked_text", "vault_index", "quarto_project"] {
        assert!(registered.contains(name), "{name}");
    }
    for name in &registered {
        for word in ["run", "exec", "spawn", "shell", "launch_file", "open_path"] {
            assert!(
                !name.contains(word) || name == "launch_options",
                "{name} looks like a launcher"
            );
        }
    }
}

#[test]
fn c33_nothing_deletes_files_except_the_safe_save_and_temporary_file_code() {
    // Phase 3: file operations only ever move to the Trash. Deleting appears in the safe save
    // (its temporary file), the small-store writer (its temporary file) and test helpers.
    let allowed = ["safe_save.rs", "fs_util.rs", "test_support.rs"];
    let source_folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut checked = 0;
    for entry in std::fs::read_dir(&source_folder).expect("src folder") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).expect("name");
        let text = std::fs::read_to_string(&path).expect("source file");
        // Unit tests make and remove their own temporary files; they start at the test module.
        let code = text.split("#[cfg(test)]").next().unwrap_or("");
        if !allowed.contains(&name) {
            for forbidden in ["remove_file", "remove_dir"] {
                assert!(!code.contains(forbidden), "{name} uses {forbidden}");
            }
        }
        checked += 1;
    }
    assert!(checked > 20, "the scan found the source files");
}
