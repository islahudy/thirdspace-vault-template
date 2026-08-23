@preconcurrency import EventKit
import Foundation

struct EventCalendar: Codable, Equatable {
  let id: String
  let title: String
  let isWritable: Bool
}

enum EventStoreSpan: String, Codable, Equatable {
  case thisEvent
  case futureEvents
}

enum ReminderStatus: String, Codable, Equatable {
  case all
  case incomplete
  case completed
}

struct ReminderQuery: Equatable {
  let status: ReminderStatus
  let listIDs: [String]?

  init(status: ReminderStatus, listIDs: [String]? = nil) {
    self.status = status
    self.listIDs = listIDs
  }
}

protocol EventRecord: AnyObject {
  var id: String? { get set }
  var title: String { get set }
  var start: Date { get set }
  var end: Date { get set }
  var isAllDay: Bool { get set }
  var calendar: EventCalendar? { get set }
  var location: String? { get set }
  var notes: String? { get set }
  var url: URL? { get set }
  var availability: String { get set }
  var hasRecurrenceRules: Bool { get }
}

protocol ReminderRecord: AnyObject {
  var id: String? { get }
  var title: String { get set }
  var list: EventCalendar? { get set }
  var isCompleted: Bool { get set }
  var completionDate: Date? { get }
  var startDate: Date? { get set }
  var dueDate: Date? { get set }
  var priority: Int { get set }
  var notes: String? { get set }
}

protocol EventStoreClient: AnyObject {
  func calendars() throws -> [EventCalendar]
  func calendar(withIdentifier identifier: String) -> EventCalendar?
  func defaultCalendarForNewEvents() -> EventCalendar?
  func events(start: Date, end: Date, calendarIDs: [String]?) throws -> [any EventRecord]
  func event(withIdentifier identifier: String) -> (any EventRecord)?
  func makeEvent() -> any EventRecord
  func save(_ event: any EventRecord, span: EventStoreSpan) throws
  func remove(_ event: any EventRecord, span: EventStoreSpan) throws

  func reminderLists() -> [EventCalendar]
  func reminderList(withIdentifier identifier: String) -> EventCalendar?
  func defaultReminderList() -> EventCalendar?
  func reminders(matching query: ReminderQuery) async throws -> [any ReminderRecord]
  func reminder(withIdentifier identifier: String) -> (any ReminderRecord)?
  func makeReminder() -> (any ReminderRecord)?
  func save(_ reminder: any ReminderRecord) throws
  func remove(_ reminder: any ReminderRecord) throws
}

extension EventStoreClient {
  func reminderLists() -> [EventCalendar] { [] }
  func reminderList(withIdentifier identifier: String) -> EventCalendar? { nil }
  func defaultReminderList() -> EventCalendar? { nil }
  func reminders(matching query: ReminderQuery) async throws -> [any ReminderRecord] { [] }
  func reminder(withIdentifier identifier: String) -> (any ReminderRecord)? { nil }
  func makeReminder() -> (any ReminderRecord)? { nil }
  func save(_ reminder: any ReminderRecord) throws { throw LiveEventStoreError.unsupportedRecord }
  func remove(_ reminder: any ReminderRecord) throws { throw LiveEventStoreError.unsupportedRecord }
}

final class LiveEventStoreClient: EventStoreClient {
  private let store: EKEventStore

  init(store: EKEventStore = EKEventStore()) {
    self.store = store
  }

  func calendars() throws -> [EventCalendar] {
    store.calendars(for: .event).map(EventCalendar.init)
  }

  func calendar(withIdentifier identifier: String) -> EventCalendar? {
    store.calendar(withIdentifier: identifier).map(EventCalendar.init)
  }

  func defaultCalendarForNewEvents() -> EventCalendar? {
    store.defaultCalendarForNewEvents.map(EventCalendar.init)
  }

  func events(start: Date, end: Date, calendarIDs: [String]?) throws -> [any EventRecord] {
    let calendars = calendarIDs.map { ids in
      ids.compactMap { store.calendar(withIdentifier: $0) }
    }
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    return store.events(matching: predicate).map { LiveEventRecord($0, store: store) }
  }

  func event(withIdentifier identifier: String) -> (any EventRecord)? {
    store.event(withIdentifier: identifier).map { LiveEventRecord($0, store: store) }
  }

  func makeEvent() -> any EventRecord {
    LiveEventRecord(EKEvent(eventStore: store), store: store)
  }

  func save(_ event: any EventRecord, span: EventStoreSpan) throws {
    guard let event = event as? LiveEventRecord else {
      throw LiveEventStoreError.unsupportedRecord
    }
    try store.save(event.event, span: span.eventKitSpan, commit: true)
  }

  func remove(_ event: any EventRecord, span: EventStoreSpan) throws {
    guard let event = event as? LiveEventRecord else {
      throw LiveEventStoreError.unsupportedRecord
    }
    try store.remove(event.event, span: span.eventKitSpan, commit: true)
  }

  func reminderLists() -> [EventCalendar] {
    store.calendars(for: .reminder).map(EventCalendar.init)
  }

  func reminderList(withIdentifier identifier: String) -> EventCalendar? {
    guard let calendar = store.calendar(withIdentifier: identifier),
          calendar.allowedEntityTypes.contains(.reminder) else {
      return nil
    }
    return EventCalendar(calendar)
  }

  func defaultReminderList() -> EventCalendar? {
    store.defaultCalendarForNewReminders().map(EventCalendar.init)
  }

  func reminders(matching query: ReminderQuery) async throws -> [any ReminderRecord] {
    let calendars: [EKCalendar]? = query.listIDs.map { ids in
      ids.compactMap { identifier -> EKCalendar? in
        guard let calendar = store.calendar(withIdentifier: identifier),
              calendar.allowedEntityTypes.contains(.reminder) else {
          return nil
        }
        return calendar
      }
    }
    let predicate: NSPredicate
    switch query.status {
    case .all:
      predicate = store.predicateForReminders(in: calendars)
    case .incomplete:
      predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
    case .completed:
      predicate = store.predicateForCompletedReminders(withCompletionDateStarting: nil, ending: nil, calendars: calendars)
    }
    let result: UncheckedSendable<[EKReminder]> = try await withCheckedThrowingContinuation { continuation in
      store.fetchReminders(matching: predicate) { reminders in
        continuation.resume(returning: .init(reminders ?? []))
      }
    }
    return result.value.map { LiveReminderRecord($0, store: store) }
  }

  func reminder(withIdentifier identifier: String) -> (any ReminderRecord)? {
    (store.calendarItem(withIdentifier: identifier) as? EKReminder).map { LiveReminderRecord($0, store: store) }
  }

  func makeReminder() -> (any ReminderRecord)? {
    LiveReminderRecord(EKReminder(eventStore: store), store: store)
  }

  func save(_ reminder: any ReminderRecord) throws {
    guard let reminder = reminder as? LiveReminderRecord else {
      throw LiveEventStoreError.unsupportedRecord
    }
    try store.save(reminder.reminder, commit: true)
  }

  func remove(_ reminder: any ReminderRecord) throws {
    guard let reminder = reminder as? LiveReminderRecord else {
      throw LiveEventStoreError.unsupportedRecord
    }
    try store.remove(reminder.reminder, commit: true)
  }
}

private extension EventCalendar {
  init(_ calendar: EKCalendar) {
    self.init(
      id: calendar.calendarIdentifier,
      title: calendar.title,
      isWritable: calendar.allowsContentModifications
    )
  }
}

private extension EventStoreSpan {
  var eventKitSpan: EKSpan {
    switch self {
    case .thisEvent: .thisEvent
    case .futureEvents: .futureEvents
    }
  }
}

private final class LiveEventRecord: EventRecord {
  let event: EKEvent
  private let store: EKEventStore

  init(_ event: EKEvent, store: EKEventStore) {
    self.event = event
    self.store = store
  }

  var id: String? {
    get { event.eventIdentifier }
    set { }
  }

  var title: String {
    get { event.title ?? "" }
    set { event.title = newValue }
  }

  var start: Date {
    get { event.startDate }
    set { event.startDate = newValue }
  }

  var end: Date {
    get { event.endDate }
    set { event.endDate = newValue }
  }

  var isAllDay: Bool {
    get { event.isAllDay }
    set { event.isAllDay = newValue }
  }

  var calendar: EventCalendar? {
    get { event.calendar.map(EventCalendar.init) }
    set {
      guard let newValue else { return }
      event.calendar = store.calendar(withIdentifier: newValue.id)
    }
  }

  var location: String? {
    get { event.location }
    set { event.location = newValue }
  }

  var notes: String? {
    get { event.notes }
    set { event.notes = newValue }
  }

  var url: URL? {
    get { event.url }
    set { event.url = newValue }
  }

  var availability: String {
    get { event.availability.bridgeValue }
    set { event.availability = EKEventAvailability(bridgeValue: newValue) }
  }

  var hasRecurrenceRules: Bool {
    !(event.recurrenceRules?.isEmpty ?? true)
  }
}

private final class LiveReminderRecord: ReminderRecord {
  let reminder: EKReminder
  private let store: EKEventStore

  init(_ reminder: EKReminder, store: EKEventStore) {
    self.reminder = reminder
    self.store = store
  }

  var id: String? {
    reminder.calendarItemIdentifier
  }

  var title: String {
    get { reminder.title ?? "" }
    set { reminder.title = newValue }
  }

  var list: EventCalendar? {
    get { reminder.calendar.map(EventCalendar.init) }
    set {
      guard let newValue else { return }
      reminder.calendar = store.calendar(withIdentifier: newValue.id)
    }
  }

  var isCompleted: Bool {
    get { reminder.isCompleted }
    set { reminder.isCompleted = newValue }
  }

  var completionDate: Date? {
    reminder.completionDate
  }

  var startDate: Date? {
    get { Self.date(from: reminder.startDateComponents) }
    set { reminder.startDateComponents = Self.components(from: newValue) }
  }

  var dueDate: Date? {
    get { Self.date(from: reminder.dueDateComponents) }
    set { reminder.dueDateComponents = Self.components(from: newValue) }
  }

  var priority: Int {
    get { reminder.priority }
    set { reminder.priority = newValue }
  }

  var notes: String? {
    get { reminder.notes }
    set { reminder.notes = newValue }
  }

  private static func date(from components: DateComponents?) -> Date? {
    components.flatMap { Calendar.current.date(from: $0) }
  }

  private static func components(from date: Date?) -> DateComponents? {
    date.map { Calendar.current.dateComponents(in: .current, from: $0) }
  }
}

private extension EKEventAvailability {
  var bridgeValue: String {
    switch self {
    case .notSupported: "notSupported"
    case .free: "free"
    case .busy: "busy"
    case .tentative: "tentative"
    case .unavailable: "unavailable"
    @unknown default: "notSupported"
    }
  }

  init(bridgeValue: String) {
    switch bridgeValue {
    case "free": self = .free
    case "tentative": self = .tentative
    case "unavailable": self = .unavailable
    case "notSupported": self = .notSupported
    default: self = .busy
    }
  }
}

private enum LiveEventStoreError: Error {
  case unsupportedRecord
}

private struct UncheckedSendable<Value>: @unchecked Sendable {
  let value: Value

  init(_ value: Value) {
    self.value = value
  }
}
