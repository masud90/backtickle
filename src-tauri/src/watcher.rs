//! The file watcher: one watcher for the whole app, through the macOS FSEvents
//! backend of the `notify` crate. No polling.
//!
//! - `watch(set)` replaces the watched set. Open documents and linked files are watched through
//!   their parent folders, not recursively, and events are filtered to exactly those paths. The
//!   open folder is watched recursively and filtered by the skip rules of `folders.rs`.
//! - Events are coalesced over 150 ms and delivered as one batch of `FileChange`.
//! - The app's own writes are suppressed. Code that writes (the safe save, the file operations)
//!   records what it did in `OwnWrites`: the size, modification time and a hash of the content,
//!   or that a path is gone. An event whose path still looks exactly like that is dropped; an
//!   outside change to the same path differs and is reported.
//! - Only granted paths are watched (`resolve`).
//!
//! The core here knows nothing about Tauri: `bridge.rs` turns a batch into the `file-changed`
//! event and the trace line.

use crate::folders;
use crate::grants::PathGrants;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::hash::Hasher;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant, SystemTime};

/// Events of one burst are delivered together after this long.
pub const COALESCE: Duration = Duration::from_millis(150);
/// How long the app remembers one of its own writes.
const OWN_WRITE_TTL: Duration = Duration::from_secs(5);
/// How many own writes are remembered at most.
const MAX_OWN_WRITES: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Modified,
    Created,
    Removed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Document,
    Linked,
    Folder,
}

impl Scope {
    pub fn name(self) -> &'static str {
        match self {
            Scope::Document => "document",
            Scope::Linked => "linked",
            Scope::Folder => "folder",
        }
    }
}

/// `FileChange` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileChange {
    pub path: String,
    pub kind: ChangeKind,
    pub scope: Scope,
}

// ---- the app's own writes ---------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Expected {
    /// A file with this size, modification time and content hash.
    File {
        size: u64,
        modified_ms: u64,
        hash: u64,
    },
    /// A folder that was created, renamed or moved here: the folder and everything below it.
    Folder,
    /// Nothing is there any more (trashed or moved away): the path and everything below it.
    Gone,
}

#[derive(Debug, Clone)]
struct Own {
    expected: Expected,
    at: Instant,
}

/// What the app itself wrote or removed in the last few seconds.
#[derive(Default)]
pub struct OwnWrites {
    entries: Mutex<HashMap<PathBuf, Own>>,
}

/// What a path looks like now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Now {
    Missing,
    Folder,
    File { size: u64, modified_ms: u64 },
}

fn look(path: &Path) -> Now {
    match std::fs::symlink_metadata(path) {
        Err(_) => Now::Missing,
        Ok(metadata) if metadata.is_dir() => Now::Folder,
        Ok(metadata) => Now::File {
            size: metadata.len(),
            modified_ms: crate::fs_util::modified_ms(&metadata),
        },
    }
}

fn hash_file(path: &Path) -> Option<u64> {
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    hasher.write(&bytes);
    Some(hasher.finish())
}

impl OwnWrites {
    /// The one shared instance that the writing code calls.
    pub fn global() -> &'static OwnWrites {
        static GLOBAL: OnceLock<OwnWrites> = OnceLock::new();
        GLOBAL.get_or_init(OwnWrites::default)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, Own>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn insert(&self, path: &Path, expected: Expected) {
        let mut entries = self.lock();
        let now = Instant::now();
        entries.retain(|_, own| now.duration_since(own.at) < OWN_WRITE_TTL);
        if entries.len() >= MAX_OWN_WRITES
            && let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, own)| own.at)
                .map(|(path, _)| path.clone())
        {
            entries.remove(&oldest);
        }
        entries.insert(path.to_path_buf(), Own { expected, at: now });
    }

    /// The app has just written or created `path` (a file or a folder). Call after the write.
    pub fn wrote(&self, path: &Path) {
        match look(path) {
            Now::File { size, modified_ms } => {
                if let Some(hash) = hash_file(path) {
                    self.insert(
                        path,
                        Expected::File {
                            size,
                            modified_ms,
                            hash,
                        },
                    );
                }
            }
            Now::Folder => self.insert(path, Expected::Folder),
            Now::Missing => {}
        }
    }

    /// The app has just moved `path` to the Trash or away. Call after the operation.
    pub fn removed(&self, path: &Path) {
        self.insert(path, Expected::Gone);
    }

    /// The app has just renamed or moved `from` to `to`.
    pub fn moved(&self, from: &Path, to: &Path) {
        self.removed(from);
        self.wrote(to);
    }

    /// True if the event for `path` is nothing but the app's own doing.
    fn explains(&self, path: &Path, now: Now) -> bool {
        let mut entries = self.lock();
        let at = Instant::now();
        entries.retain(|_, own| at.duration_since(own.at) < OWN_WRITE_TTL);
        for (own_path, own) in entries.iter() {
            match &own.expected {
                Expected::Gone => {
                    if now == Now::Missing && path.starts_with(own_path) {
                        return true;
                    }
                }
                Expected::Folder => {
                    // The folder and what is below a folder the app created or moved here.
                    if path.starts_with(own_path) && now != Now::Missing {
                        return true;
                    }
                }
                Expected::File {
                    size,
                    modified_ms,
                    hash,
                } => {
                    if path == own_path
                        && let Now::File {
                            size: now_size,
                            modified_ms: now_modified,
                        } = now
                        && now_size == *size
                        && now_modified == *modified_ms
                        && hash_file(path) == Some(*hash)
                    {
                        return true;
                    }
                }
            }
        }
        false
    }
}

// ---- what is watched ---------------------------------------------------------------------------

/// The watch set after the grants were checked.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResolvedSet {
    pub documents: HashSet<PathBuf>,
    pub linked: HashSet<PathBuf>,
    pub folder: Option<PathBuf>,
    pub ignore: Vec<String>,
}

/// `WatchSet` in `src/lib/platform.ts`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct WatchRequest {
    pub documents: Vec<String>,
    pub linked: Vec<String>,
    pub folder: Option<String>,
}

/// Keeps the granted paths of a request; anything else is left out silently.
pub fn resolve(
    grants: &PathGrants,
    documents: &[String],
    linked: &[String],
    folder: Option<&str>,
    ignore: &[String],
) -> ResolvedSet {
    let permitted = |text: &String| {
        let path = PathBuf::from(text);
        (path.is_absolute() && path.parent().is_some() && grants.is_permitted(&path))
            .then_some(path)
    };
    ResolvedSet {
        documents: documents.iter().filter_map(permitted).collect(),
        linked: linked
            .iter()
            .filter_map(|text| {
                permitted(text).or_else(|| {
                    grants
                        .check_readable(Path::new(text))
                        .ok()
                        .filter(|path| path.parent().is_some())
                })
            })
            .collect(),
        folder: folder.and_then(|text| grants.check_folder(Path::new(text)).ok()),
        ignore: ignore.to_vec(),
    }
}

impl ResolvedSet {
    /// The folders to give to the operating system: parents of files (not recursive) and the open
    /// folder (recursive). A parent inside the open folder is covered by it.
    fn roots(&self) -> HashMap<PathBuf, bool> {
        let mut roots: HashMap<PathBuf, bool> = HashMap::new();
        for file in self.documents.iter().chain(self.linked.iter()) {
            if let Some(parent) = file.parent() {
                roots.entry(parent.to_path_buf()).or_insert(false);
            }
        }
        if let Some(folder) = &self.folder {
            roots.insert(folder.clone(), true);
        }
        let folder = self.folder.clone();
        if let Some(folder) = folder {
            roots.retain(|path, recursive| *recursive || !path.starts_with(&folder));
        }
        roots
    }

    /// The scopes a path belongs to; `now` is what the path looks like.
    fn scopes(&self, path: &Path, now: Now) -> Vec<Scope> {
        let mut scopes = Vec::new();
        if self.documents.contains(path) {
            scopes.push(Scope::Document);
        }
        if self.linked.contains(path) {
            scopes.push(Scope::Linked);
        }
        if let Some(folder) = &self.folder
            && self.in_folder_scope(folder, path, now)
        {
            scopes.push(Scope::Folder);
        }
        scopes
    }

    fn in_folder_scope(&self, folder: &Path, path: &Path, now: Now) -> bool {
        let Ok(relative) = path.strip_prefix(folder) else {
            return false;
        };
        let mut components = relative.components().peekable();
        if components.peek().is_none() {
            return false; // the folder itself
        }
        for component in relative.components() {
            let name = component.as_os_str().to_string_lossy();
            if folders::skipped_name(&name, &self.ignore) {
                return false;
            }
        }
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        match now {
            Now::Folder => true,
            Now::File { .. } => folders::is_listed_file(&name),
            // A removed item: a Markdown-family file, or a name without an extension (a folder).
            Now::Missing => {
                folders::is_listed_file(&name) || Path::new(&name).extension().is_none()
            }
        }
    }
}

// ---- the watcher ----------------------------------------------------------------------------------

/// Receives each coalesced batch, on the watcher's own thread.
pub type Sink = Arc<dyn Fn(Vec<FileChange>) + Send + Sync>;

struct Shared {
    set: ResolvedSet,
    /// Whether each watched file existed when last seen, to tell created from modified.
    present: HashMap<PathBuf, bool>,
    /// When the set was last replaced or a batch last handled: a file born after this is new.
    since: SystemTime,
}

struct Active {
    notify: RecommendedWatcher,
    roots: HashMap<PathBuf, bool>,
}

pub struct Watcher {
    shared: Arc<Mutex<Shared>>,
    active: Mutex<Active>,
}

#[derive(Default, Clone, Copy)]
struct Hints {
    created: bool,
    renamed: bool,
}

fn merge(pending: &mut HashMap<PathBuf, Hints>, event: Event) {
    let hints = match event.kind {
        EventKind::Create(_) => Hints {
            created: true,
            renamed: false,
        },
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => Hints {
            created: false,
            renamed: true,
        },
        EventKind::Access(_) => return,
        _ => Hints::default(),
    };
    for path in event.paths {
        let entry = pending.entry(path).or_default();
        entry.created |= hints.created;
        entry.renamed |= hints.renamed;
    }
}

fn born_after(path: &Path, since: SystemTime) -> bool {
    std::fs::symlink_metadata(path)
        .and_then(|metadata| metadata.created())
        .is_ok_and(|born| born >= since)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Turns the paths of one burst into changes: filtered by scope, without the app's own writes.
fn changes_for(
    pending: HashMap<PathBuf, Hints>,
    shared: &Mutex<Shared>,
    own: &OwnWrites,
) -> Vec<FileChange> {
    let mut shared = lock(shared);
    let since = std::mem::replace(&mut shared.since, SystemTime::now());
    let mut changes = Vec::new();
    let mut paths: Vec<_> = pending.into_iter().collect();
    paths.sort_by(|a, b| a.0.cmp(&b.0));
    for (path, hints) in paths {
        let now = look(&path);
        let scopes = shared.set.scopes(&path, now);
        let was_present = shared.present.get(&path).copied();
        if shared.present.contains_key(&path) {
            shared.present.insert(path.clone(), now != Now::Missing);
        }
        if scopes.is_empty() || own.explains(&path, now) {
            continue;
        }
        let kind = match now {
            Now::Missing => ChangeKind::Removed,
            Now::Folder if !(hints.created || hints.renamed) => continue,
            _ => match was_present {
                Some(true) => ChangeKind::Modified,
                Some(false) => ChangeKind::Created,
                // FSEvents keeps the "created" and "renamed" flags of a path for later events, so
                // they cannot tell a new file from an old one. Its birth time can.
                None if born_after(&path, since) => ChangeKind::Created,
                None => ChangeKind::Modified,
            },
        };
        for scope in scopes {
            changes.push(FileChange {
                path: crate::fs_util::path_text(&path),
                kind,
                scope,
            });
        }
    }
    changes
}

fn worker(
    events: mpsc::Receiver<notify::Result<Event>>,
    shared: Arc<Mutex<Shared>>,
    own: &'static OwnWrites,
    sink: Sink,
) {
    let mut pending: HashMap<PathBuf, Hints> = HashMap::new();
    let mut deadline: Option<Instant> = None;
    loop {
        let received = match deadline {
            None => events.recv().map_err(|_| RecvTimeoutError::Disconnected),
            Some(at) => events.recv_timeout(at.saturating_duration_since(Instant::now())),
        };
        match received {
            Ok(Ok(event)) => {
                if pending.is_empty() {
                    deadline = Some(Instant::now() + COALESCE);
                }
                merge(&mut pending, event);
            }
            Ok(Err(_)) => {}
            Err(RecvTimeoutError::Timeout) => {
                deadline = None;
                let batch = std::mem::take(&mut pending);
                let changes = changes_for(batch, &shared, own);
                if !changes.is_empty() {
                    sink(changes);
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

impl Watcher {
    /// Starts the watcher and its thread. `own` is where the app's own writes are looked up.
    pub fn start(sink: Sink, own: &'static OwnWrites) -> notify::Result<Watcher> {
        let (sender, events): (Sender<notify::Result<Event>>, _) = mpsc::channel();
        let notify = RecommendedWatcher::new(
            move |event| {
                let _ = sender.send(event);
            },
            Config::default(),
        )?;
        let shared = Arc::new(Mutex::new(Shared {
            set: ResolvedSet::default(),
            present: HashMap::new(),
            since: SystemTime::now(),
        }));
        let thread_shared = Arc::clone(&shared);
        std::thread::Builder::new()
            .name("writedown-watcher".to_owned())
            .spawn(move || worker(events, thread_shared, own, sink))
            .map_err(notify::Error::io)?;
        Ok(Watcher {
            shared,
            active: Mutex::new(Active {
                notify,
                roots: HashMap::new(),
            }),
        })
    }

    /// Replaces the whole watch set.
    pub fn set(&self, set: ResolvedSet) {
        let wanted = set.roots();
        let mut present = HashMap::new();
        for file in set.documents.iter().chain(set.linked.iter()) {
            present.insert(file.clone(), look(file) != Now::Missing);
        }
        {
            let mut shared = lock(&self.shared);
            shared.set = set;
            shared.present = present;
            shared.since = SystemTime::now();
        }
        let mut active = lock(&self.active);
        let current = active.roots.clone();
        let mut kept = HashMap::new();
        for (path, recursive) in &current {
            if wanted.get(path) == Some(recursive) {
                kept.insert(path.clone(), *recursive);
            } else {
                let _ = active.notify.unwatch(path);
            }
        }
        for (path, recursive) in wanted {
            if kept.contains_key(&path) {
                continue;
            }
            let mode = if recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };
            if active.notify.watch(&path, mode).is_ok() {
                kept.insert(path, recursive);
            }
        }
        active.roots = kept;
    }
}

/// The sets of every document window put together: the documents and linked files of all of
/// them, and the open folder of `main` (else of the first window that has one). A window's change
/// events are sent to every window; each page keeps what concerns its own documents.
pub fn merge_sets(sets: &HashMap<String, ResolvedSet>) -> ResolvedSet {
    let mut labels: Vec<&String> = sets.keys().collect();
    labels.sort_by_key(|label| {
        label
            .strip_prefix("doc-")
            .and_then(|number| number.parse::<u64>().ok())
            .map_or(0, |number| number + 1)
    });
    let mut merged = ResolvedSet::default();
    for label in labels {
        let set = &sets[label];
        merged.documents.extend(set.documents.iter().cloned());
        merged.linked.extend(set.linked.iter().cloned());
        if merged.folder.is_none() {
            merged.folder = set.folder.clone();
            merged.ignore = set.ignore.clone();
        }
    }
    merged
}

/// The managed state: the watcher is created the first time something is watched. Every
/// document window sends its own watch set; the watcher watches them all.
#[derive(Default)]
pub struct WatchService {
    watcher: Mutex<Option<Watcher>>,
    sets: Mutex<HashMap<String, ResolvedSet>>,
}

impl WatchService {
    /// Replaces the watch set of the window `label` and watches the union of all windows' sets.
    pub fn set_for(
        &self,
        label: &str,
        set: ResolvedSet,
        sink: impl FnOnce() -> Sink,
    ) -> Result<(), String> {
        let merged = {
            let mut sets = lock(&self.sets);
            sets.insert(label.to_owned(), set);
            merge_sets(&sets)
        };
        self.apply(merged, sink)
    }

    /// The window is gone: what only it needed is no longer watched.
    pub fn forget(&self, label: &str) {
        let merged = {
            let mut sets = lock(&self.sets);
            if sets.remove(label).is_none() {
                return;
            }
            merge_sets(&sets)
        };
        if let Some(watcher) = lock(&self.watcher).as_ref() {
            watcher.set(merged);
        }
    }

    fn apply(&self, set: ResolvedSet, sink: impl FnOnce() -> Sink) -> Result<(), String> {
        let mut slot = lock(&self.watcher);
        if slot.is_none() {
            if set.documents.is_empty() && set.linked.is_empty() && set.folder.is_none() {
                return Ok(()); // nothing to watch and nothing started yet
            }
            let watcher = Watcher::start(sink(), OwnWrites::global())
                .map_err(|_| "Changes to files cannot be watched.".to_owned())?;
            *slot = Some(watcher);
        }
        if let Some(watcher) = slot.as_ref() {
            watcher.set(set);
        }
        Ok(())
    }
}

/// A document window closed: its watch set is dropped.
pub fn forget_window(app: &tauri::AppHandle<tauri::Wry>, label: &str) {
    use tauri::Manager;
    if let Some(service) = app.try_state::<WatchService>() {
        service.forget(label);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_ops::{self, Trasher};
    use crate::safe_save::{self, SaveFormat, SaveOptions};
    use crate::test_support::TempDir;
    use std::sync::mpsc::Receiver;

    struct Harness {
        _watcher: Watcher,
        batches: Receiver<Vec<FileChange>>,
    }

    fn start(set: ResolvedSet) -> Harness {
        let (sender, batches) = mpsc::channel();
        let sender = Mutex::new(sender);
        let sink: Sink = Arc::new(move |changes| {
            let _ = lock(&sender).send(changes);
        });
        let watcher = Watcher::start(sink, OwnWrites::global()).expect("starts");
        watcher.set(set);
        // FSEvents may still report what happened just before it started.
        std::thread::sleep(Duration::from_millis(700));
        let harness = Harness {
            _watcher: watcher,
            batches,
        };
        while harness.batches.try_recv().is_ok() {}
        harness
    }

    fn folder_set(root: &Path) -> ResolvedSet {
        ResolvedSet {
            folder: Some(root.to_path_buf()),
            ignore: vec!["node_modules".to_owned()],
            ..ResolvedSet::default()
        }
    }

    fn granted(dir: &TempDir) -> (PathGrants, PathBuf) {
        let grants = PathGrants::default();
        let root = grants.grant_folder(dir.path()).expect("grant");
        (grants, root)
    }

    fn save(path: &Path, text: &str) {
        let format = SaveFormat {
            encoding: crate::encoding::Encoding::Utf8,
            line_ending: crate::line_endings::LineEnding::Lf,
        };
        let options = SaveOptions {
            overwrite_external_change: true,
            ..SaveOptions::default()
        };
        safe_save::save(path, text, format, &options, None).expect("saves");
    }

    fn summary(changes: &[FileChange]) -> Vec<(String, ChangeKind, Scope)> {
        let mut out: Vec<_> = changes
            .iter()
            .map(|c| {
                (
                    Path::new(&c.path)
                        .file_name()
                        .expect("name")
                        .to_string_lossy()
                        .into_owned(),
                    c.kind,
                    c.scope,
                )
            })
            .collect();
        out.sort();
        out
    }

    struct FolderTrash(PathBuf);

    impl Trasher for FolderTrash {
        fn trash(&self, path: &Path) -> std::io::Result<()> {
            std::fs::rename(path, self.0.join(path.file_name().expect("name")))
        }
    }

    #[test]
    fn an_outside_write_create_and_remove_arrive_in_one_batch_within_a_second() {
        let dir = TempDir::new();
        let (_grants, root) = granted(&dir);
        dir.write("edit.md", b"one");
        dir.write("gone.md", b"bye");
        let harness = start(folder_set(&root));

        let began = Instant::now();
        std::fs::write(root.join("edit.md"), b"two, changed").expect("write");
        std::fs::write(root.join("new.md"), b"fresh").expect("create");
        std::fs::remove_file(root.join("gone.md")).expect("remove");
        let batch = harness
            .batches
            .recv_timeout(Duration::from_secs(1))
            .expect("a batch within a second");

        assert!(began.elapsed() < Duration::from_secs(1));
        assert_eq!(
            summary(&batch),
            [
                ("edit.md".to_owned(), ChangeKind::Modified, Scope::Folder),
                ("gone.md".to_owned(), ChangeKind::Removed, Scope::Folder),
                ("new.md".to_owned(), ChangeKind::Created, Scope::Folder),
            ]
        );
        assert!(
            harness
                .batches
                .recv_timeout(Duration::from_millis(400))
                .is_err(),
            "one batch only"
        );
    }

    #[test]
    fn hidden_ignored_and_other_files_in_the_folder_are_not_reported() {
        let dir = TempDir::new();
        let (_grants, root) = granted(&dir);
        std::fs::create_dir(root.join("node_modules")).expect("mkdir");
        std::fs::create_dir(root.join(".hidden")).expect("mkdir");
        let harness = start(folder_set(&root));

        std::fs::write(root.join("node_modules/a.md"), b"x").expect("write");
        std::fs::write(root.join(".hidden/b.md"), b"x").expect("write");
        std::fs::write(root.join(".c.md"), b"x").expect("write");
        std::fs::write(root.join("data.csv"), b"x").expect("write");

        assert!(
            harness
                .batches
                .recv_timeout(Duration::from_millis(800))
                .is_err()
        );
    }

    #[test]
    fn the_apps_own_save_rename_and_trash_are_not_reported() {
        let dir = TempDir::new();
        let outer = TempDir::new();
        let (grants, root) = granted(&dir);
        let first = dir.write("a.md", b"start");
        let second = dir.write("b.md", b"start");
        let harness = start(folder_set(&root));

        save(&first, "saved by the app");
        let renamed = file_ops::rename_path(&grants, &second, "c.md").expect("renamed");
        let trasher = FolderTrash(outer.path().to_path_buf());
        file_ops::trash_path(&grants, &renamed, &trasher).expect("trashed");
        let created = file_ops::create_file(&grants, &root, "n.md").expect("created");
        file_ops::duplicate_path(&grants, &created).expect("copy");

        assert!(
            harness
                .batches
                .recv_timeout(Duration::from_millis(900))
                .is_err(),
            "the app's own work is not a change"
        );

        // An outside write to the same file afterwards is reported.
        std::fs::write(&first, b"changed from outside, longer").expect("write");
        let batch = harness
            .batches
            .recv_timeout(Duration::from_secs(1))
            .expect("outside change reported");
        assert_eq!(
            summary(&batch),
            [("a.md".to_owned(), ChangeKind::Modified, Scope::Folder)]
        );
    }

    #[test]
    fn a_document_is_watched_through_its_folder_and_only_that_path_is_reported() {
        let dir = TempDir::new();
        let document = dir.write("doc.md", b"one");
        let other = dir.write("other.md", b"one");
        let harness = start(ResolvedSet {
            documents: HashSet::from([document.clone()]),
            ..ResolvedSet::default()
        });

        std::fs::write(&other, b"changed other").expect("write");
        std::fs::write(&document, b"changed doc").expect("write");
        let batch = harness
            .batches
            .recv_timeout(Duration::from_secs(1))
            .expect("batch");
        assert_eq!(
            summary(&batch),
            [("doc.md".to_owned(), ChangeKind::Modified, Scope::Document)]
        );

        std::fs::remove_file(&document).expect("remove");
        let batch = harness
            .batches
            .recv_timeout(Duration::from_secs(1))
            .expect("batch");
        assert_eq!(
            summary(&batch),
            [("doc.md".to_owned(), ChangeKind::Removed, Scope::Document)]
        );
    }

    #[test]
    fn a_linked_file_has_the_linked_scope_and_a_replaced_set_stops_the_old_watch() {
        let dir = TempDir::new();
        let linked = dir.write("refs.bib", b"one");
        let harness = start(ResolvedSet {
            linked: HashSet::from([linked.clone()]),
            ..ResolvedSet::default()
        });
        std::fs::write(&linked, b"changed refs").expect("write");
        let batch = harness
            .batches
            .recv_timeout(Duration::from_secs(1))
            .expect("batch");
        assert_eq!(
            summary(&batch),
            [("refs.bib".to_owned(), ChangeKind::Modified, Scope::Linked)]
        );

        harness._watcher.set(ResolvedSet::default());
        std::thread::sleep(Duration::from_millis(300));
        while harness.batches.try_recv().is_ok() {}
        std::fs::write(&linked, b"changed again, longer").expect("write");
        assert!(
            harness
                .batches
                .recv_timeout(Duration::from_millis(700))
                .is_err()
        );
    }

    #[test]
    fn only_granted_paths_are_kept_in_the_set() {
        let dir = TempDir::new();
        let elsewhere = TempDir::new();
        let (grants, root) = granted(&dir);
        let inside = dir.write("in.md", b"x");
        let outside = elsewhere.write("out.md", b"x");

        let set = resolve(
            &grants,
            &[
                inside.to_string_lossy().into_owned(),
                outside.to_string_lossy().into_owned(),
                "relative.md".to_owned(),
            ],
            &[outside.to_string_lossy().into_owned()],
            Some(&elsewhere.path().to_string_lossy()),
            &[],
        );

        assert_eq!(set.documents, HashSet::from([inside]));
        assert!(set.linked.is_empty());
        assert_eq!(set.folder, None);

        let set = resolve(&grants, &[], &[], Some(&root.to_string_lossy()), &[]);
        assert_eq!(set.folder, Some(root));
    }

    #[test]
    fn roots_are_parents_of_files_and_a_recursive_folder_covers_those_inside_it() {
        let set = ResolvedSet {
            documents: HashSet::from([
                PathBuf::from("/w/open/a.md"),
                PathBuf::from("/w/elsewhere/b.md"),
            ]),
            linked: HashSet::from([PathBuf::from("/w/open/sub/c.bib")]),
            folder: Some(PathBuf::from("/w/open")),
            ignore: Vec::new(),
        };

        let roots = set.roots();

        assert_eq!(roots.len(), 2);
        assert_eq!(roots.get(Path::new("/w/open")), Some(&true));
        assert_eq!(roots.get(Path::new("/w/elsewhere")), Some(&false));
    }

    #[test]
    fn own_writes_match_only_while_the_file_still_looks_like_what_was_written() {
        let dir = TempDir::new();
        let own = OwnWrites::default();
        let path = dir.write("x.md", b"abcd");
        own.wrote(&path);

        assert!(own.explains(&path, look(&path)));
        std::fs::write(&path, b"abce").expect("same size, other content");
        // The modification time may be the same millisecond; the hash tells them apart.
        assert!(!own.explains(&path, look(&path)));

        let gone = dir.path().join("gone.md");
        own.removed(&gone);
        assert!(own.explains(&gone, Now::Missing));
        assert!(own.explains(&gone.join("child.md"), Now::Missing));
        std::fs::write(&gone, b"back").expect("recreated by someone");
        assert!(!own.explains(&gone, look(&gone)));
    }

    #[test]
    fn e51_the_sets_of_all_windows_are_watched_together() {
        let dir_a = PathBuf::from("/notes");
        let mut sets = HashMap::new();
        sets.insert(
            "main".to_owned(),
            ResolvedSet {
                documents: HashSet::from([PathBuf::from("/notes/a.md")]),
                linked: HashSet::from([PathBuf::from("/notes/refs.bib")]),
                folder: Some(dir_a.clone()),
                ignore: vec!["node_modules".to_owned()],
            },
        );
        sets.insert(
            "doc-1".to_owned(),
            ResolvedSet {
                documents: HashSet::from([PathBuf::from("/other/b.md")]),
                linked: HashSet::new(),
                folder: Some(PathBuf::from("/other")),
                ignore: vec![],
            },
        );

        let merged = merge_sets(&sets);

        assert_eq!(merged.documents.len(), 2);
        assert!(merged.documents.contains(Path::new("/other/b.md")));
        assert!(merged.linked.contains(Path::new("/notes/refs.bib")));
        assert_eq!(merged.folder, Some(dir_a), "main's folder wins");
        assert_eq!(merged.ignore, ["node_modules"]);
    }

    #[test]
    fn e51_a_window_without_a_folder_does_not_hide_anothers() {
        let mut sets = HashMap::new();
        sets.insert("main".to_owned(), ResolvedSet::default());
        sets.insert(
            "doc-2".to_owned(),
            ResolvedSet {
                folder: Some(PathBuf::from("/f")),
                ..ResolvedSet::default()
            },
        );

        assert_eq!(merge_sets(&sets).folder, Some(PathBuf::from("/f")));
        assert_eq!(merge_sets(&HashMap::new()), ResolvedSet::default());
    }
}
