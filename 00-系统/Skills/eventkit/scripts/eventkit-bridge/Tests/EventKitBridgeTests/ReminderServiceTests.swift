import Foundation
import Testing
@testable import EventKitBridge

@MainActor @Suite struct ReminderServiceTests {
  @Test func listUsesAllPredicate() async throws {
    let store = FakeReminderStore(reminders: [.incomplete(id: "REM-1")])

    _ = try await ReminderService(store: store).list(.init(status: .all))

    #expect(store.lastReminderQuery?.status == .all)
  }

  @Test func listUsesIncompletePredicate() async throws {
    let store = FakeReminderStore(reminders: [.incomplete(id: "REM-1")])

    let result = try await ReminderService(store: store).list(.init(status: .incomplete))

    #expect(store.lastReminderQuery?.status == .incomplete)
    #expect(result.map(\.id) == ["REM-1"])
  }

  @Test func reminderDTOIncludesExternalIdentifierWhenAvailable() async throws {
    let store = FakeReminderStore(reminders: [
      .incomplete(id: "REM-1", externalId: "EXT-REM-1"),
    ])

    let result = try await ReminderService(store: store).list()

    #expect(result.first?.externalId == "EXT-REM-1")
  }

  @Test func listUsesCompletedPredicate() async throws {
    let store = FakeReminderStore(reminders: [.completed(id: "REM-1")])

    let result = try await ReminderService(store: store).list(.init(status: .completed))

    #expect(store.lastReminderQuery?.status == .completed)
    #expect(result.map(\.id) == ["REM-1"])
  }

  @Test func listFiltersByRequestedLists() async throws {
    let store = FakeReminderStore(reminders: [
      .incomplete(id: "REM-1", listID: "work"),
      .incomplete(id: "REM-2", listID: "home"),
    ])

    let result = try await ReminderService(store: store).list(
      .init(status: .all, listIDs: ["work"])
    )

    #expect(store.lastReminderQuery?.listIDs == ["work"])
    #expect(result.map(\.id) == ["REM-1"])
  }

  @Test func createUsesDefaultReminderListWhenNoListIsRequested() async throws {
    let personal = EventCalendar(id: "personal", title: "Personal", isWritable: true)
    let store = FakeReminderStore(lists: [personal], defaultListID: "personal")

    let result = try await ReminderService(store: store).create(.init(title: "Buy milk"))

    #expect(result.list.id == "personal")
    #expect(store.defaultReminderListRequests == 1)
  }

  @Test func getFetchesReminderByIdentifier() async throws {
    let store = FakeReminderStore(reminders: [
      .incomplete(id: "REM-1", externalId: "EXT-REM-1"),
    ])

    let result = try await ReminderService(store: store).get(
      id: "REM-1",
      externalId: "EXT-REM-1"
    )

    #expect(store.requestedReminderIDs == ["REM-1"])
    #expect(store.requestedExternalIDs.isEmpty)
    #expect(result.id == "REM-1")
  }

  @Test func staleIdentifierFallsBackToOneExternalReminder() async throws {
    let store = FakeReminderStore(reminders: [
      .incomplete(id: "REM-NEW", externalId: "EXT-REM-1"),
    ])

    let result = try await ReminderService(store: store).setCompleted(
      id: "REM-STALE",
      externalId: "EXT-REM-1",
      completed: true
    )

    #expect(store.requestedReminderIDs == ["REM-STALE"])
    #expect(store.requestedExternalIDs == ["EXT-REM-1"])
    #expect(result.id == "REM-NEW")
    #expect(store.savedReminderIDs == ["REM-NEW"])
  }

  @Test func zeroExternalReminderMatchesRetainNotFound() async throws {
    let store = FakeReminderStore()

    let failure = try await bridgeFailure {
      _ = try await ReminderService(store: store).get(
        id: "REM-STALE",
        externalId: "EXT-MISSING"
      )
    }

    #expect(failure.error.code == .reminderNotFound)
    #expect(store.requestedExternalIDs == ["EXT-MISSING"])
  }

  @Test func multipleExternalReminderMatchesFailWithoutMutation() async throws {
    let store = FakeReminderStore(reminders: [
      .incomplete(id: "REM-A", externalId: "EXT-DUPLICATE"),
      .incomplete(id: "REM-B", externalId: "EXT-DUPLICATE"),
    ])

    let failure = try await bridgeFailure {
      try await ReminderService(store: store).delete(
        id: "REM-STALE",
        externalId: "EXT-DUPLICATE"
      )
    }

    #expect(failure.error.code == .eventKitError)
    #expect(failure.error.message == "Multiple Reminders share the external identifier.")
    #expect(store.savedReminderIDs.isEmpty)
  }

  @Test func missingReminderUsesStableError() async {
    let store = FakeReminderStore()

    await #expect(throws: BridgeFailure.self) {
      try await ReminderService(store: store).get(id: "missing")
    }
  }

  @Test func saveFailureMapsToBridgeFailure() async throws {
    let work = EventCalendar(id: "work", title: "Work", isWritable: true)
    let store = FakeReminderStore(lists: [work], saveError: .saveFailed)

    let failure = try await bridgeFailure {
      _ = try await ReminderService(store: store).create(.init(title: "Planning", listID: "work"))
    }

    #expect(failure.error.code == .saveFailed)
  }

  @Test func deleteFailureMapsToBridgeFailure() async throws {
    let store = FakeReminderStore(
      reminders: [.incomplete(id: "REM-1")],
      removeError: .removeFailed
    )

    let failure = try await bridgeFailure {
      try await ReminderService(store: store).delete(id: "REM-1")
    }

    #expect(failure.error.code == .deleteFailed)
  }

  @Test func completeSetsCompletedAndReturnsLatestDTO() async throws {
    let store = FakeReminderStore(reminders: [.incomplete(id: "REM-1")])

    let result = try await ReminderService(store: store).setCompleted(id: "REM-1", completed: true)

    #expect(result.completed == true)
    #expect(result.completionDate == DateCodec.formatInstant(store.savedCompletionDate))
    #expect(store.savedReminderIDs == ["REM-1"])
  }

  @Test func reopeningClearsCompletionState() async throws {
    let store = FakeReminderStore(reminders: [.completed(id: "REM-1")])

    let result = try await ReminderService(store: store).setCompleted(id: "REM-1", completed: false)

    #expect(result.completed == false)
    #expect(result.completionDate == nil)
  }
}

@MainActor private final class FakeReminderStore: EventStoreClient {
  var reminders: [FakeReminder]
  var listsByID: [String: EventCalendar]
  let defaultListID: String?
  let saveError: FakeReminderStoreError?
  let removeError: FakeReminderStoreError?
  let savedCompletionDate = Date(timeIntervalSince1970: 1_234_567_890)
  private(set) var lastReminderQuery: ReminderQuery?
  private(set) var defaultReminderListRequests = 0
  private(set) var requestedReminderIDs: [String] = []
  private(set) var requestedExternalIDs: [String] = []
  private(set) var savedReminderIDs: [String] = []

  init(
    reminders: [FakeReminder] = [],
    lists: [EventCalendar] = [FakeReminder.defaultList],
    defaultListID: String? = "default",
    saveError: FakeReminderStoreError? = nil,
    removeError: FakeReminderStoreError? = nil
  ) {
    self.reminders = reminders
    listsByID = Dictionary(uniqueKeysWithValues: lists.map { ($0.id, $0) })
    self.defaultListID = defaultListID
    self.saveError = saveError
    self.removeError = removeError
  }

  func reminderLists() -> [EventCalendar] {
    Array(listsByID.values)
  }

  func reminderList(withIdentifier identifier: String) -> EventCalendar? {
    listsByID[identifier]
  }

  func defaultReminderList() -> EventCalendar? {
    defaultReminderListRequests += 1
    guard let defaultListID else { return nil }
    return listsByID[defaultListID]
  }

  func reminders(matching query: ReminderQuery) async throws -> [any ReminderRecord] {
    lastReminderQuery = query
    return reminders.filter { reminder in
      let matchesStatus = switch query.status {
      case .all: true
      case .incomplete: !reminder.isCompleted
      case .completed: reminder.isCompleted
      }
      let matchesList = query.listIDs.map { $0.contains(reminder.list?.id ?? "") } ?? true
      return matchesStatus && matchesList
    }
  }

  func reminder(withIdentifier identifier: String) -> (any ReminderRecord)? {
    requestedReminderIDs.append(identifier)
    return reminders.first { $0.id == identifier }
  }

  func calendarItems(withExternalIdentifier identifier: String) -> [CalendarItemRecord] {
    requestedExternalIDs.append(identifier)
    return reminders.filter { $0.externalId == identifier }.map(CalendarItemRecord.reminder)
  }

  func makeReminder() -> (any ReminderRecord)? {
    FakeReminder(id: nil, externalId: nil, title: "", list: nil, isCompleted: false)
  }

  func save(_ reminder: any ReminderRecord) throws {
    if let saveError { throw saveError }
    guard let reminder = reminder as? FakeReminder else { throw FakeReminderStoreError.unexpectedReminder }
    if reminder.id == nil { reminder.id = "NEW-\(savedReminderIDs.count + 1)" }
    if !reminders.contains(where: { $0 === reminder }) { reminders.append(reminder) }
    reminder.completionDate = reminder.isCompleted ? savedCompletionDate : nil
    savedReminderIDs.append(reminder.id!)
  }

  func remove(_ reminder: any ReminderRecord) throws {
    if let removeError { throw removeError }
    guard let reminder = reminder as? FakeReminder, let id = reminder.id else {
      throw FakeReminderStoreError.unexpectedReminder
    }
    reminders.removeAll { $0 === reminder }
    savedReminderIDs.append("removed:\(id)")
  }

  func calendars() throws -> [EventCalendar] { [] }
  func calendar(withIdentifier identifier: String) -> EventCalendar? { nil }
  func defaultCalendarForNewEvents() -> EventCalendar? { nil }
  func events(start: Date, end: Date, calendarIDs: [String]?) throws -> [any EventRecord] { [] }
  func event(withIdentifier identifier: String) -> (any EventRecord)? { nil }
  func makeEvent() -> any EventRecord { fatalError("Not used by ReminderServiceTests") }
  func save(_ event: any EventRecord, span: EventStoreSpan) throws {}
  func remove(_ event: any EventRecord, span: EventStoreSpan) throws {}
}

@MainActor private final class FakeReminder: ReminderRecord {
  static let defaultList = EventCalendar(id: "default", title: "Default", isWritable: true)

  var id: String?
  let externalId: String?
  var title: String
  var list: EventCalendar?
  var isCompleted: Bool
  var completionDate: Date?
  var startDate: Date?
  var dueDate: Date?
  var priority: Int
  var notes: String?

  init(
    id: String?,
    externalId: String?,
    title: String,
    list: EventCalendar?,
    isCompleted: Bool,
    completionDate: Date? = nil,
    startDate: Date? = nil,
    dueDate: Date? = nil,
    priority: Int = 0,
    notes: String? = nil
  ) {
    self.id = id
    self.externalId = externalId
    self.title = title
    self.list = list
    self.isCompleted = isCompleted
    self.completionDate = completionDate
    self.startDate = startDate
    self.dueDate = dueDate
    self.priority = priority
    self.notes = notes
  }

  static func incomplete(
    id: String,
    listID: String = "default",
    externalId: String? = nil
  ) -> FakeReminder {
    .init(
      id: id,
      externalId: externalId,
      title: id,
      list: .init(id: listID, title: listID, isWritable: true),
      isCompleted: false
    )
  }

  static func completed(
    id: String,
    listID: String = "default",
    externalId: String? = nil
  ) -> FakeReminder {
    .init(
      id: id,
      externalId: externalId,
      title: id,
      list: .init(id: listID, title: listID, isWritable: true),
      isCompleted: true,
      completionDate: Date(timeIntervalSince1970: 0)
    )
  }
}

private enum FakeReminderStoreError: Error {
  case saveFailed
  case removeFailed
  case unexpectedReminder
}

private enum ReminderServiceTestError: Error {
  case expectedBridgeFailure
}

@MainActor private func bridgeFailure(_ operation: () async throws -> Void) async throws -> BridgeFailure {
  do {
    try await operation()
    throw ReminderServiceTestError.expectedBridgeFailure
  } catch let failure as BridgeFailure {
    return failure
  }
}
