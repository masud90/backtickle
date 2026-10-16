fn main() {
    // Every command the web view may call is listed here AND granted in a capability file
    // (capabilities/main.json, capabilities/preferences.json). A command missing from either
    // place is refused. New commands: add the name below, then add `allow-<name-with-dashes>`
    // to the capability of every window that needs it.
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "ping",
        "app_version",
        "launch_options",
        "pick_file",
        "read_text_file",
        "perf_mark",
        "bench_report",
        "bench_search_report",
        // Phase 1 (src/bridge.rs)
        "open_dialog",
        "save_dialog",
        "read_document",
        "save_document",
        "document_context",
        "reveal_in_finder",
        "open_external",
        "open_linked_document",
        "reveal_linked_file",
        "resolve_image",
        "recent_documents",
        "open_recent",
        "remove_recent",
        "clear_recents",
        "get_settings",
        "get_snippets",
        "set_snippets",
        "update_settings",
        "get_doc_state",
        "set_doc_state",
        "take_pending_open_files",
        "confirm_unsaved",
        "ask",
        "update_menu_state",
        "set_window_title",
        "open_preferences",
        "ack_close",
        "finish_close",
        "cancel_close",
        "menu_ready",
        // Phase 2 (src/bridge.rs)
        "read_linked_text",
        "vault_index",
        "quarto_project",
        // Phase 3 (src/bridge.rs)
        "folder_dialog",
        "list_folder",
        "file_index",
        "create_file",
        "create_folder",
        "rename_path",
        "move_path",
        "duplicate_path",
        "trash_path",
        "write_clipboard",
        "read_clipboard_text",
        "print_page",
        "write_export",
        "pandoc_info",
        "export_docx",
        // Phase 5 (exact preview through Pandoc)
        "pandoc_preview",
        "cancel_pandoc_preview",
        // Phase 5 (src/bridge.rs)
        "export_pdf",
        // Phase 5 (Render with Quarto)
        "render_with_quarto",
        "read_image_bytes",
        // Images pasted or dropped into the editor (src/pasted_images.rs)
        "save_pasted_image",
        "import_dropped_image",
        "get_session",
        // Phase 5 (several document windows)
        "move_tab",
        "take_transfer",
        "set_window_documents",
        "set_document_edited",
        "focus_open_document",
        "restore_windows",
        "set_session",
        // Phase 5 (crash recovery)
        "recovery_write",
        "recovery_remove",
        "recovery_list",
        "watch",
        "search_folder",
        "cancel_search",
        // Phase 4 (src/bridge.rs)
        "choose_pandoc",
        "choose_default_folder",
        // Phase 5 (src/bridge.rs, Preferences General)
        "default_markdown_app",
        "make_default_markdown_app",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to run tauri-build");
}
