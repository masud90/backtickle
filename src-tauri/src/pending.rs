//! Events for a page that may not be ready for them.
//!
//! A document window's page needs a moment after it is created before it listens for events
//! (and the window itself may not exist, see `lifecycle.rs`). Events that arrive in that time
//! are queued and handed over when the page says it is ready: `takePendingOpenFiles` for
//! opened files, the registration of the menu action listener for menu actions. From then on
//! events are delivered at once. When the page goes away (the window is closed or the page is
//! reloaded) the queue is "not ready" again; what was queued stays.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

/// What to do with an event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Routed<T> {
    /// The page is ready: send these now.
    Deliver(Vec<T>),
    /// The page is not ready: they were queued.
    Queued,
}

#[derive(Debug)]
pub struct PageQueue<T> {
    ready: bool,
    pending: Vec<T>,
}

impl<T> Default for PageQueue<T> {
    fn default() -> Self {
        PageQueue {
            ready: false,
            pending: Vec::new(),
        }
    }
}

impl<T> PageQueue<T> {
    /// An event (a batch of items) has arrived.
    pub fn route(&mut self, items: Vec<T>) -> Routed<T> {
        if self.ready {
            Routed::Deliver(items)
        } else {
            self.pending.extend(items);
            Routed::Queued
        }
    }

    /// The page is ready: returns everything that was queued, in order, and from now on
    /// `route` delivers.
    pub fn take_and_ready(&mut self) -> Vec<T> {
        self.ready = true;
        std::mem::take(&mut self.pending)
    }

    /// The page is gone or reloading: events are queued again. The queue is kept.
    pub fn reset(&mut self) {
        self.ready = false;
    }

    pub fn is_ready(&self) -> bool {
        self.ready
    }

    pub fn queued(&self) -> usize {
        self.pending.len()
    }
}

#[derive(Debug, Default)]
struct Queues {
    files: PageQueue<String>,
    actions: PageQueue<String>,
}

/// The queues of every document window's page, as managed state: opened files and menu actions,
/// each window with its own pair (the label is the window's label, `main` or `doc-<n>`).
#[derive(Debug, Default)]
pub struct Pages {
    queues: Mutex<HashMap<String, Queues>>,
}

impl Pages {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Queues>> {
        self.queues.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Opened files (canonical paths) have arrived for a window.
    pub fn route_files(&self, label: &str, paths: Vec<String>) -> Routed<String> {
        self.lock()
            .entry(label.to_owned())
            .or_default()
            .files
            .route(paths)
    }

    /// `takePendingOpenFiles`: the window's page is ready for opened files.
    pub fn take_files(&self, label: &str) -> Vec<String> {
        self.lock()
            .entry(label.to_owned())
            .or_default()
            .files
            .take_and_ready()
    }

    /// A menu action has arrived for a window.
    pub fn route_actions(&self, label: &str, actions: Vec<String>) -> Routed<String> {
        self.lock()
            .entry(label.to_owned())
            .or_default()
            .actions
            .route(actions)
    }

    /// The window's page registered its menu action listener.
    pub fn take_actions(&self, label: &str) -> Vec<String> {
        self.lock()
            .entry(label.to_owned())
            .or_default()
            .actions
            .take_and_ready()
    }

    /// The window's page is being created, reloaded or has gone: events are queued again.
    pub fn reset(&self, label: &str) {
        let mut queues = self.lock();
        let entry = queues.entry(label.to_owned()).or_default();
        entry.files.reset();
        entry.actions.reset();
    }

    /// The window is gone for good: its queues are dropped (a window that opens later under the
    /// same label starts clean).
    pub fn forget(&self, label: &str) {
        self.lock().remove(label);
    }

    /// How many files and actions wait for the window's page.
    pub fn queued(&self, label: &str) -> (usize, usize) {
        let queues = self.lock();
        queues.get(label).map_or((0, 0), |entry| {
            (entry.files.queued(), entry.actions.queued())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_before_the_page_is_ready_are_queued() {
        let mut queue = PageQueue::<String>::default();

        assert_eq!(queue.route(vec!["a".into()]), Routed::Queued);
        assert_eq!(queue.route(vec!["b".into(), "c".into()]), Routed::Queued);

        assert!(!queue.is_ready());
        assert_eq!(queue.queued(), 3);
    }

    #[test]
    fn taking_hands_over_the_queue_in_order_and_makes_the_page_ready() {
        let mut queue = PageQueue::<String>::default();
        queue.route(vec!["a".into()]);
        queue.route(vec!["b".into(), "c".into()]);

        assert_eq!(queue.take_and_ready(), ["a", "b", "c"]);

        assert!(queue.is_ready());
        assert_eq!(queue.queued(), 0);
        assert!(
            queue.take_and_ready().is_empty(),
            "nothing is handed over twice"
        );
    }

    #[test]
    fn once_the_page_is_ready_events_are_delivered_at_once() {
        let mut queue = PageQueue::<String>::default();
        queue.take_and_ready();

        assert_eq!(
            queue.route(vec!["a".into(), "b".into()]),
            Routed::Deliver(vec!["a".into(), "b".into()])
        );
        assert_eq!(queue.queued(), 0);
    }

    #[test]
    fn taking_from_an_empty_queue_still_makes_the_page_ready() {
        let mut queue = PageQueue::<u8>::default();

        assert!(queue.take_and_ready().is_empty());

        assert!(queue.is_ready());
    }

    #[test]
    fn a_page_that_goes_away_makes_the_queue_collect_again_and_keeps_what_it_had() {
        let mut queue = PageQueue::<u8>::default();
        queue.route(vec![1]);
        queue.reset();
        queue.take_and_ready();
        queue.route(vec![2]);

        queue.reset();

        assert!(!queue.is_ready());
        assert_eq!(queue.route(vec![3]), Routed::Queued);
        assert_eq!(queue.route(vec![4]), Routed::Queued);
        assert_eq!(queue.take_and_ready(), [3, 4]);
    }

    #[test]
    fn items_that_repeat_are_all_kept() {
        // Two "new" menu actions are two new documents.
        let mut queue = PageQueue::<&str>::default();
        queue.route(vec!["new"]);
        queue.route(vec!["new"]);

        assert_eq!(queue.take_and_ready(), ["new", "new"]);
    }

    #[test]
    fn an_empty_batch_is_queued_or_delivered_like_any_other() {
        let mut queue = PageQueue::<u8>::default();

        assert_eq!(queue.route(vec![]), Routed::Queued);
        queue.take_and_ready();
        assert_eq!(queue.route(vec![]), Routed::Deliver(vec![]));
    }

    #[test]
    fn r08_files_opened_before_the_page_is_ready_are_taken_by_the_page() {
        let pages = Pages::default();

        assert_eq!(
            pages.route_files("main", vec!["/a.md".into()]),
            Routed::Queued
        );
        assert_eq!(
            pages.route_files("main", vec!["/b.md".into()]),
            Routed::Queued
        );
        assert_eq!(pages.queued("main"), (2, 0));

        assert_eq!(pages.take_files("main"), ["/a.md", "/b.md"]);
        assert_eq!(
            pages.route_files("main", vec!["/c.md".into()]),
            Routed::Deliver(vec!["/c.md".into()]),
            "from now on files are delivered at once"
        );
    }

    #[test]
    fn files_and_menu_actions_become_ready_independently() {
        let pages = Pages::default();
        pages.take_files("main");

        assert_eq!(
            pages.route_actions("main", vec!["new".into()]),
            Routed::Queued
        );
        assert_eq!(
            pages.route_files("main", vec!["/a.md".into()]),
            Routed::Deliver(vec!["/a.md".into()])
        );
        assert_eq!(pages.take_actions("main"), ["new"]);
        assert_eq!(
            pages.route_actions("main", vec!["save".into()]),
            Routed::Deliver(vec!["save".into()])
        );
    }

    #[test]
    fn a_page_that_goes_away_queues_both_kinds_again() {
        let pages = Pages::default();
        pages.take_files("main");
        pages.take_actions("main");

        pages.reset("main");

        assert_eq!(
            pages.route_files("main", vec!["/a.md".into()]),
            Routed::Queued
        );
        assert_eq!(
            pages.route_actions("main", vec!["new".into()]),
            Routed::Queued
        );
        assert_eq!(pages.queued("main"), (1, 1));
        assert_eq!(pages.take_files("main"), ["/a.md"]);
        assert_eq!(pages.take_actions("main"), ["new"]);
    }

    #[test]
    fn e51_every_window_has_its_own_queues() {
        let pages = Pages::default();
        pages.take_files("main");

        assert_eq!(
            pages.route_files("main", vec!["/a.md".into()]),
            Routed::Deliver(vec!["/a.md".into()])
        );
        assert_eq!(
            pages.route_files("doc-1", vec!["/b.md".into()]),
            Routed::Queued,
            "the new window's page is not ready yet"
        );
        assert_eq!(pages.queued("doc-1"), (1, 0));
        assert_eq!(pages.queued("main"), (0, 0));

        assert_eq!(pages.take_files("doc-1"), ["/b.md"]);
        pages.forget("doc-1");
        assert_eq!(pages.queued("doc-1"), (0, 0));
        assert_eq!(
            pages.route_files("doc-1", vec!["/c.md".into()]),
            Routed::Queued,
            "a window created under the same label later starts clean"
        );
    }
}
