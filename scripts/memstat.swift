// memstat: memory of one macOS app including the WebKit helper processes that belong to it.
//
// Build (done on demand by scripts/measure.mjs):
//   swiftc -O scripts/memstat.swift -o scripts/.bin/memstat
//
// Usage:
//   memstat <pid>           JSON array, one entry per attributed process:
//                           { pid, name, role, phys_footprint_bytes, ... }
//   memstat --screen-locked prints "true" or "false" (key CGSSessionScreenIsLocked of
//                           CGSessionCopyCurrentDictionary); "unknown" with exit code 3 if the
//                           session state cannot be read
//   memstat --session-state JSON { screen_locked, on_console, display_asleep, display_refresh_hz,
//                           display_count } (same source, plus whether this login session is the
//                           one on screen, whether the main display is asleep, and the refresh
//                           rate of the main display, which the typing benchmark depends on)
//
// Memory figure: ri_phys_footprint from proc_pid_rusage (RUSAGE_INFO_V4). This is the "Memory"
// column of Activity Monitor and the "phys_footprint" line of /usr/bin/footprint. Bytes, not MB.
//
// Which processes belong to the app (the part that is easy to get wrong):
//
//   WebKit runs a web view in separate XPC helper processes (WebContent, GPU, Networking). Their
//   parent is launchd (pid 1), not the app, and other apps have helpers with identical names, so
//   neither the parent pid nor the name identifies them. Activity Monitor groups them with the
//   app through the "responsible process" (private API responsibility_get_pid_responsible_for_pid,
//   looked up with dlsym). An entry's `basis` field says which rule put it in the list:
//
//   "app"          the pid given on the command line.
//   "responsible"  its responsible pid is the app. This is the rule when the app is its own
//                  responsible process, as after a Finder, Dock or `open` launch. Besides the
//                  WebKit helpers, macOS then also attributes a few small system services to the
//                  app (seen on macOS 27: SetStoreUpdateService and com.apple.audio.SandboxHelper,
//                  about 7.5 MB together). They get role "other", and the harness keeps them out
//                  of the total.
//   "inherited"    The app was started by another process that holds the responsibility (for
//                  example from a terminal or a script: its responsible pid is not itself). The
//                  helpers then carry that same inherited responsible pid, and so does every
//                  other process of that tree. A process is counted only if it also is a WebKit
//                  helper (executable named com.apple.WebKit.*) that started at or after the app.
//   "descendant"   a child, grandchild, ... of the app by parent pid.
//   "heuristic"    only when the responsibility API is missing or fails for a WebKit helper: a
//                  WebKit helper that started at or after the app. Weaker, and reported loudly.
//
// Failure rules: nothing is silent. The JSON is always printed, and every problem is reported on
// stderr with a line starting "memstat: WARNING". The exit code says how bad it is:
//   3  the list is not usable as a total: no WebKit helper was found at all (the list would be
//      the app process alone), or the memory of an attributed process could not be read.
//   4  usable but weakened: /usr/bin/footprint had to replace proc_pid_rusage for a process, or
//      a WebKit helper was matched by the "heuristic" rule.
// If proc_pid_rusage fails for a process, /usr/bin/footprint is tried before giving up.
//
// Exit codes: 0 clean, 2 usage error or pid not found, 3 unusable result, 4 usable with caveats.

import CoreGraphics
import Darwin
import Foundation

// MARK: output

func eprint(_ text: String) {
    FileHandle.standardError.write(Data((text + "\n").utf8))
}

func emit(_ text: String) {
    FileHandle.standardOutput.write(Data((text + "\n").utf8))
}

func jsonString(_ object: Any) -> String {
    guard JSONSerialization.isValidJSONObject(object),
        let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
        let text = String(data: data, encoding: .utf8)
    else {
        eprint("memstat: internal error: could not encode JSON")
        exit(2)
    }
    return text
}

// MARK: session state

/// nil when the session dictionary cannot be read (for example outside a login session).
func sessionDictionary() -> [String: Any]? {
    return CGSessionCopyCurrentDictionary() as? [String: Any]
}

func truthy(_ value: Any?) -> Bool? {
    guard let value = value else { return nil }
    if let flag = value as? Bool { return flag }
    if let number = value as? NSNumber { return number.boolValue }
    return true  // present but not a boolean: treat as set
}

/// The key is only present while the screen is locked.
func screenLocked() -> Bool? {
    guard let dictionary = sessionDictionary() else { return nil }
    return truthy(dictionary["CGSSessionScreenIsLocked"]) ?? false
}

func runSessionMode(_ arguments: [String]) -> Never {
    if arguments.first == "--screen-locked" {
        guard let locked = screenLocked() else {
            emit("unknown")
            eprint("memstat: cannot read the session dictionary (CGSessionCopyCurrentDictionary)")
            exit(3)
        }
        emit(locked ? "true" : "false")
        exit(0)
    }
    guard let dictionary = sessionDictionary() else {
        eprint("memstat: cannot read the session dictionary (CGSessionCopyCurrentDictionary)")
        exit(3)
    }
    var state: [String: Any] = [
        "screen_locked": truthy(dictionary["CGSSessionScreenIsLocked"]) ?? false,
        "on_console": truthy(dictionary["kCGSSessionOnConsoleKey"]) ?? true,
        "display_asleep": CGDisplayIsAsleep(CGMainDisplayID()) != 0,
    ]
    if let mode = CGDisplayCopyDisplayMode(CGMainDisplayID()), mode.refreshRate > 0 {
        state["display_refresh_hz"] = mode.refreshRate
    }
    var displayCount: UInt32 = 0
    if CGGetActiveDisplayList(0, nil, &displayCount) == .success {
        state["display_count"] = Int(displayCount)
    }
    emit(jsonString(state))
    exit(0)
}

// MARK: processes

typealias ResponsibleFunction = @convention(c) (pid_t) -> pid_t

/// Private but long-standing libSystem API. Looked up at run time so that a missing symbol is a
/// reportable condition instead of a build or launch failure.
func loadResponsibleFunction() -> ResponsibleFunction? {
    let handle = UnsafeMutableRawPointer(bitPattern: -2)  // RTLD_DEFAULT
    guard let symbol = dlsym(handle, "responsibility_get_pid_responsible_for_pid") else {
        return nil
    }
    return unsafeBitCast(symbol, to: ResponsibleFunction.self)
}

func allPids() -> [pid_t] {
    var capacity = 4096
    while true {
        var pids = [pid_t](repeating: 0, count: capacity)
        let count = Int(proc_listallpids(&pids, Int32(capacity * MemoryLayout<pid_t>.size)))
        if count <= 0 { return [] }
        if count < capacity { return pids.prefix(count).filter { $0 > 0 } }
        capacity *= 2
    }
}

func executablePath(_ pid: pid_t) -> String? {
    var buffer = [CChar](repeating: 0, count: 4096)  // PROC_PIDPATHINFO_MAXSIZE
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    return length > 0 ? String(cString: buffer) : nil
}

struct Birth {
    let parent: pid_t
    /// Microseconds since the epoch.
    let started: UInt64
}

func birth(_ pid: pid_t) -> Birth? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
    return Birth(
        parent: pid_t(info.pbi_ppid),
        started: info.pbi_start_tvsec &* 1_000_000 &+ info.pbi_start_tvusec)
}

func lastComponent(_ path: String) -> String {
    return (path as NSString).lastPathComponent
}

/// A WebKit XPC helper: the executable is named com.apple.WebKit.<Something>.
func isWebKitHelper(_ path: String) -> Bool {
    return lastComponent(path).hasPrefix("com.apple.WebKit.")
}

func role(forPath path: String?, isApp: Bool) -> String {
    if isApp { return "app" }
    guard let path = path else { return "other" }
    let name = lastComponent(path)
    if name.hasPrefix("com.apple.WebKit.WebContent") { return "webkit-webcontent" }
    if name.hasPrefix("com.apple.WebKit.GPU") { return "webkit-gpu" }
    if name.hasPrefix("com.apple.WebKit.Networking") { return "webkit-networking" }
    return "other"
}

// MARK: memory

struct Footprint {
    let current: UInt64
    let lifetimeMax: UInt64
}

func rusageFootprint(_ pid: pid_t) -> Footprint? {
    var usage = rusage_info_v4()
    let result = withUnsafeMutablePointer(to: &usage) { pointer -> Int32 in
        pointer.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) {
            proc_pid_rusage(pid, RUSAGE_INFO_V4, $0)
        }
    }
    guard result == 0 else { return nil }
    return Footprint(current: usage.ri_phys_footprint, lifetimeMax: usage.ri_lifetime_max_phys_footprint)
}

/// Fallback: ask /usr/bin/footprint, which prints "phys_footprint: <n> B" with `-f bytes`.
func footprintTool(_ pid: pid_t) -> Footprint? {
    let tool = "/usr/bin/footprint"
    guard FileManager.default.isExecutableFile(atPath: tool) else { return nil }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: tool)
    process.arguments = ["-p", String(pid), "-f", "bytes", "--noCategories"]
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0, let text = String(data: data, encoding: .utf8) else {
        return nil
    }
    var current: UInt64?
    var peak: UInt64?
    for line in text.split(separator: "\n") {
        let fields = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
        guard fields.count >= 2, let value = UInt64(fields[1]) else { continue }
        if fields[0] == "phys_footprint:" { current = value }
        if fields[0] == "phys_footprint_peak:" { peak = value }
    }
    guard let current = current else { return nil }
    return Footprint(current: current, lifetimeMax: peak ?? current)
}

// MARK: attribution

func runProcessMode(_ appPid: pid_t) -> Never {
    var caveats: [String] = []  // result usable, but weaker than normal (exit code 4)
    var problems: [String] = []  // result not usable as a total (exit code 3)
    let responsibleOf = loadResponsibleFunction()
    if responsibleOf == nil {
        caveats.append(
            "responsibility_get_pid_responsible_for_pid is not available: WebKit helpers are "
                + "matched by name and start time only (basis \"heuristic\")")
    }

    let pids = allPids()
    guard pids.contains(appPid) else {
        eprint("memstat: process \(appPid) not found")
        exit(2)
    }
    guard let appBirth = birth(appPid) else {
        eprint("memstat: cannot read process info of \(appPid)")
        exit(2)
    }

    var responsible: [pid_t: pid_t] = [:]
    if let responsibleOf = responsibleOf {
        for pid in pids {
            let value = responsibleOf(pid)
            if value > 0 { responsible[pid] = value }
        }
    }
    let appResponsible = responsible[appPid]
    let inheritedCase = appResponsible != nil && appResponsible != appPid

    var basis: [pid_t: String] = [appPid: "app"]
    var paths: [pid_t: String] = [:]
    var births: [pid_t: Birth] = [appPid: appBirth]
    func pathOf(_ pid: pid_t) -> String? {
        if let known = paths[pid] { return known }
        guard let path = executablePath(pid) else { return nil }
        paths[pid] = path
        return path
    }
    func birthOf(_ pid: pid_t) -> Birth? {
        if let known = births[pid] { return known }
        guard let value = birth(pid) else { return nil }
        births[pid] = value
        return value
    }
    func startedAtOrAfterApp(_ pid: pid_t) -> Bool {
        guard let value = birthOf(pid) else { return false }
        return value.started >= appBirth.started
    }

    // Rule "responsible": the responsible process is the app itself.
    if responsibleOf != nil {
        for pid in pids where pid != appPid && responsible[pid] == appPid {
            basis[pid] = "responsible"
        }
    }

    // Rule "inherited": the app does not hold its own responsibility, so its helpers share the
    // inherited responsible pid with everything else in that tree. Narrow to WebKit helpers
    // that started at or after the app.
    if inheritedCase, let shared = appResponsible {
        for pid in pids where pid != appPid && responsible[pid] == shared && basis[pid] == nil {
            guard let path = pathOf(pid), isWebKitHelper(path), startedAtOrAfterApp(pid) else {
                continue
            }
            basis[pid] = "inherited"
        }
    }

    // Rule "heuristic": no usable responsible pid for a WebKit helper that started after the app.
    for pid in pids where pid != appPid && basis[pid] == nil && responsible[pid] == nil {
        guard let path = pathOf(pid), isWebKitHelper(path), startedAtOrAfterApp(pid) else {
            continue
        }
        basis[pid] = "heuristic"
        if responsibleOf != nil {
            caveats.append(
                "responsibility lookup failed for WebKit helper \(pid): attributed by name and "
                    + "start time only (basis \"heuristic\")")
        }
    }

    // Rule "descendant": children by parent pid, any depth.
    var children: [pid_t: [pid_t]] = [:]
    for pid in pids {
        if let value = birthOf(pid) { children[value.parent, default: []].append(pid) }
    }
    var queue: [pid_t] = [appPid]
    var visited: Set<pid_t> = [appPid]
    while let current = queue.first {
        queue.removeFirst()
        for child in children[current] ?? [] where !visited.contains(child) {
            visited.insert(child)
            if basis[child] == nil { basis[child] = "descendant" }
            queue.append(child)
        }
    }

    // Memory.
    let order: [String: Int] = [
        "app": 0, "webkit-webcontent": 1, "webkit-gpu": 2, "webkit-networking": 3, "other": 4,
    ]
    var entries: [(pid: pid_t, role: String, entry: [String: Any])] = []
    for (pid, why) in basis {
        let path = pathOf(pid)
        let roleName = role(forPath: path, isApp: pid == appPid)
        var source = "proc_pid_rusage"
        var footprint = rusageFootprint(pid)
        if footprint == nil {
            footprint = footprintTool(pid)
            if footprint != nil {
                source = "footprint"
                caveats.append(
                    "proc_pid_rusage failed for pid \(pid); used /usr/bin/footprint instead")
            }
        }
        var entry: [String: Any] = [
            "pid": Int(pid),
            "name": path.map(lastComponent) ?? "unknown",
            "role": roleName,
            "basis": why,
            "responsible_pid": responsible[pid].map { Int($0) } ?? NSNull(),
        ]
        if let footprint = footprint {
            entry["phys_footprint_bytes"] = footprint.current
            entry["lifetime_max_phys_footprint_bytes"] = footprint.lifetimeMax
            entry["source"] = source
        } else {
            entry["phys_footprint_bytes"] = NSNull()
            entry["lifetime_max_phys_footprint_bytes"] = NSNull()
            entry["source"] = "unavailable"
            problems.append(
                "memory of pid \(pid) (\(roleName)) could not be read with proc_pid_rusage or "
                    + "/usr/bin/footprint")
        }
        entries.append((pid, roleName, entry))
    }
    entries.sort {
        let left = order[$0.role] ?? 9
        let right = order[$1.role] ?? 9
        return left != right ? left < right : $0.pid < $1.pid
    }

    emit(jsonString(entries.map { $0.entry }))

    let helperCount = entries.filter { $0.role.hasPrefix("webkit-") }.count
    if helperCount == 0 {
        problems.append(
            "NO WebKit helper process was attributed to pid \(appPid). The list above is the app "
                + "process alone and is NOT the total memory of the app.")
    }
    for text in Set(problems).sorted() { eprint("memstat: WARNING: UNUSABLE: " + text) }
    for text in Set(caveats).sorted() { eprint("memstat: WARNING: " + text) }
    exit(!problems.isEmpty ? 3 : (!caveats.isEmpty ? 4 : 0))
}

// MARK: main

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.count == 1, arguments[0] == "--screen-locked" || arguments[0] == "--session-state" {
    runSessionMode(arguments)
}
if arguments.count == 1, let value = Int32(arguments[0]), value > 0 {
    runProcessMode(value)
}
eprint("usage: memstat <pid> | memstat --screen-locked | memstat --session-state")
exit(2)
