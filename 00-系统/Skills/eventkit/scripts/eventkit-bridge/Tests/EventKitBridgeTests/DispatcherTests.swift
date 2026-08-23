import EventKit
import Foundation
import Testing
@testable import EventKitBridge

@MainActor @Suite struct DispatcherTests {
  @Test func dispatchesEverySupportedAction() async throws {
    let requests: [BridgeRequest] = [
      request("auth.status"),
      request("auth.request"),
      request("calendar.calendars"),
      request("calendar.list", [
        "start": .string("2026-08-23T00:00:00+08:00"),
        "end": .string("2026-08-24T00:00:00+08:00"),
      ]),
      request("calendar.get", ["id": .string("EVT-1")]),
      request("calendar.create", [
        "title": .string("Planning"),
        "start": .string("2026-08-23T09:00:00+08:00"),
        "end": .string("2026-08-23T10:00:00+08:00"),
      ]),
      request("calendar.update", ["id": .string("EVT-1"), "title": .string("Updated")]),
      request("calendar.delete", ["id": .string("EVT-1")]),
      request("reminder.lists"),
      request("reminder.list", ["status": .string("all")]),
      request("reminder.get", ["id": .string("REM-1")]),
      request("reminder.create", ["title": .string("Buy milk")]),
      request("reminder.update", ["id": .string("REM-1"), "title": .string("Updated")]),
      request("reminder.delete", ["id": .string("REM-1")]),
      request("reminder.complete", ["id": .string("REM-1")]),
      request("reminder.reopen", ["id": .string("REM-1")]),
    ]

    for request in requests {
      let permissions = FakePermissionClient()
      let dispatcher = BridgeDispatcher(store: FakeDispatcherStore(), permissions: permissions)

      let object = try responseObject(await dispatcher.dispatch(request))

      #expect(object["success"] as? Bool == true, "Expected \(request.action) to dispatch successfully")
      if request.action == "auth.request" {
        #expect(permissions.requestCount == 1)
      }
    }
  }

  @Test func unknownActionReturnsInvalidRequest() async throws {
    let dispatcher = BridgeDispatcher(store: FakeDispatcherStore(), permissions: FakePermissionClient())

    let response = await dispatcher.dispatch(request("unknown"))

    #expect(try errorCode(response) == "INVALID_REQUEST")
  }

  @Test func everySupportedActionRejectsNonObjectParams() async throws {
    let actions = [
      "auth.status", "auth.request",
      "calendar.calendars", "calendar.list", "calendar.get", "calendar.create",
      "calendar.update", "calendar.delete",
      "reminder.lists", "reminder.list", "reminder.get", "reminder.create",
      "reminder.update", "reminder.delete", "reminder.complete", "reminder.reopen",
    ]

    for action in actions {
      let dispatcher = BridgeDispatcher(store: FakeDispatcherStore(), permissions: FakePermissionClient())

      let response = await dispatcher.dispatch(.init(action: action, params: .array([])))

      #expect(try errorCode(response) == "INVALID_REQUEST", "Expected \(action) to validate params")
    }
  }

  @Test func malformedAuthRequestParamsDoNotRequestPermission() async throws {
    let permissions = FakePermissionClient()
    let dispatcher = BridgeDispatcher(store: FakeDispatcherStore(), permissions: permissions)

    let response = await dispatcher.dispatch(.init(action: "auth.request", params: .string("bad")))

    #expect(try errorCode(response) == "INVALID_REQUEST")
    #expect(permissions.requestCount == 0)
  }

  @Test func calendarCreateDecodesEverySupportedAvailability() async throws {
    let supportedValues = ["notSupported", "free", "busy", "tentative", "unavailable"]

    for availability in supportedValues {
      let store = FakeDispatcherStore()
      let dispatcher = BridgeDispatcher(store: store, permissions: FakePermissionClient())

      let response = await dispatcher.dispatch(request("calendar.create", [
        "title": .string("Planning"),
        "start": .string("2026-08-23T09:00:00+08:00"),
        "end": .string("2026-08-23T10:00:00+08:00"),
        "availability": .string(availability),
      ]))
      let object = try responseObject(response)

      #expect(object["success"] as? Bool == true)
      #expect((object["data"] as? [String: Any])?["availability"] as? String == availability)
      #expect(store.savedEventAvailabilities == [availability])
    }
  }

  @Test func calendarUpdateDecodesSupportedAvailability() async throws {
    let store = FakeDispatcherStore()
    let dispatcher = BridgeDispatcher(store: store, permissions: FakePermissionClient())

    let response = await dispatcher.dispatch(request("calendar.update", [
      "id": .string("EVT-1"),
      "availability": .string("tentative"),
    ]))
    let object = try responseObject(response)

    #expect((object["data"] as? [String: Any])?["availability"] as? String == "tentative")
    #expect(store.savedEventAvailabilities == ["tentative"])
  }

  @Test func calendarAvailabilityTypoReturnsInvalidRequestWithoutSaving() async throws {
    for action in ["calendar.create", "calendar.update"] {
      let store = FakeDispatcherStore()
      let dispatcher = BridgeDispatcher(store: store, permissions: FakePermissionClient())
      var values: [String: JSONValue] = ["availability": .string("bsy")]
      if action == "calendar.create" {
        values["title"] = .string("Planning")
        values["start"] = .string("2026-08-23T09:00:00+08:00")
        values["end"] = .string("2026-08-23T10:00:00+08:00")
      } else {
        values["id"] = .string("EVT-1")
      }

      let response = await dispatcher.dispatch(request(action, values))

      #expect(try errorCode(response) == "INVALID_REQUEST")
      #expect(store.savedEventAvailabilities.isEmpty)
    }
  }

  @Test func permissionDenialDoesNotRequestAccess() async throws {
    let permissions = FakePermissionClient(
      status: .init(calendar: .denied, reminders: .fullAccess)
    )
    let store = FakeDispatcherStore()
    let dispatcher = BridgeDispatcher(store: store, permissions: permissions)

    let response = await dispatcher.dispatch(request("calendar.calendars"))

    #expect(try errorCode(response) == "PERMISSION_DENIED")
    #expect(permissions.requestCount == 0)
    #expect(store.calendarReadCount == 0)
  }

  @Test func serviceFailuresRetainTheirExactErrorCode() async throws {
    let dispatcher = BridgeDispatcher(store: FakeDispatcherStore(), permissions: FakePermissionClient())

    let response = await dispatcher.dispatch(
      request("calendar.get", ["id": .string("MISSING")])
    )

    #expect(try errorCode(response) == "EVENT_NOT_FOUND")
  }

  @Test func lookupAndMutationActionsForwardExternalIdentifierFallback() async throws {
    let actions = [
      "calendar.get", "calendar.update", "calendar.delete",
      "reminder.get", "reminder.update", "reminder.delete",
      "reminder.complete", "reminder.reopen",
    ]

    for action in actions {
      let store = FakeDispatcherStore()
      let dispatcher = BridgeDispatcher(store: store, permissions: FakePermissionClient())
      var values: [String: JSONValue] = [
        "id": .string(action.hasPrefix("calendar.") ? "EVT-STALE" : "REM-STALE"),
        "externalId": .string(action.hasPrefix("calendar.") ? "EXT-EVT-1" : "EXT-REM-1"),
      ]
      if action.hasSuffix(".update") { values["title"] = .string("Updated") }

      let response = await dispatcher.dispatch(request(action, values))

      #expect(
        (try responseObject(response))["success"] as? Bool == true,
        "Expected \(action) to use the external identifier fallback"
      )
      #expect(store.requestedExternalIDs.count == 1)
    }
  }

  @Test func malformedExternalIdentifierIsRejectedBeforeLookup() async throws {
    let store = FakeDispatcherStore()
    let dispatcher = BridgeDispatcher(store: store, permissions: FakePermissionClient())

    let response = await dispatcher.dispatch(request("reminder.get", [
      "id": .string("REM-STALE"),
      "externalId": .number(1),
    ]))

    #expect(try errorCode(response) == "INVALID_REQUEST")
    #expect(store.requestedExternalIDs.isEmpty)
  }

  @Test func permissionServiceMapsAllEventKitStatuses() {
    let cases: [(EKAuthorizationStatus, AuthorizationState)] = [
      (.notDetermined, .notDetermined),
      (.restricted, .restricted),
      (.denied, .denied),
      (.writeOnly, .writeOnly),
      (.fullAccess, .fullAccess),
    ]

    for (eventKitStatus, expected) in cases {
      let service = PermissionService(
        client: FakeAuthorizationStore(calendar: eventKitStatus, reminders: eventKitStatus)
      )

      #expect(service.status() == .init(calendar: expected, reminders: expected))
    }
  }

  @Test func permissionRequestRequestsBothEntityTypes() async throws {
    let client = FakeAuthorizationStore(calendar: .notDetermined, reminders: .notDetermined)
    let service = PermissionService(client: client)

    let status = try await service.request()

    #expect(client.eventRequestCount == 1)
    #expect(client.reminderRequestCount == 1)
    #expect(status == .init(calendar: .fullAccess, reminders: .fullAccess))
  }
}

private func request(_ action: String, _ params: [String: JSONValue] = [:]) -> BridgeRequest {
  .init(action: action, params: .object(params))
}

private func responseObject(_ response: BridgeResponse) throws -> [String: Any] {
  try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(response)) as? [String: Any])
}

private func errorCode(_ response: BridgeResponse) throws -> String? {
  let object = try responseObject(response)
  return (object["error"] as? [String: Any])?["code"] as? String
}

@MainActor private final class FakePermissionClient: PermissionServicing {
  private(set) var currentStatus: AuthorizationSnapshot
  private(set) var requestCount = 0

  init(status: AuthorizationSnapshot = .init(calendar: .fullAccess, reminders: .fullAccess)) {
    currentStatus = status
  }

  func status() -> AuthorizationSnapshot {
    currentStatus
  }

  func request() async throws -> AuthorizationSnapshot {
    requestCount += 1
    return currentStatus
  }
}

@MainActor private final class FakeAuthorizationStore: AuthorizationStoreClient {
  private var statuses: [EKEntityType: EKAuthorizationStatus]
  private(set) var eventRequestCount = 0
  private(set) var reminderRequestCount = 0

  init(calendar: EKAuthorizationStatus, reminders: EKAuthorizationStatus) {
    statuses = [.event: calendar, .reminder: reminders]
  }

  func authorizationStatus(for entityType: EKEntityType) -> EKAuthorizationStatus {
    statuses[entityType] ?? .notDetermined
  }

  func requestFullAccessToEvents() async throws -> Bool {
    eventRequestCount += 1
    statuses[.event] = .fullAccess
    return true
  }

  func requestFullAccessToReminders() async throws -> Bool {
    reminderRequestCount += 1
    statuses[.reminder] = .fullAccess
    return true
  }
}

@MainActor private final class FakeDispatcherStore: EventStoreClient {
  private let calendar = EventCalendar(id: "CAL-1", title: "Work", isWritable: true)
  private let reminderList = EventCalendar(id: "LIST-1", title: "Tasks", isWritable: true)
  private lazy var event = FakeDispatcherEvent(calendar: calendar)
  private lazy var reminder = FakeDispatcherReminder(list: reminderList)
  private(set) var calendarReadCount = 0
  private(set) var savedEventAvailabilities: [String] = []
  private(set) var requestedExternalIDs: [String] = []

  func calendars() throws -> [EventCalendar] {
    calendarReadCount += 1
    return [calendar]
  }

  func calendar(withIdentifier identifier: String) -> EventCalendar? {
    identifier == calendar.id ? calendar : nil
  }

  func defaultCalendarForNewEvents() -> EventCalendar? { calendar }

  func events(start: Date, end: Date, calendarIDs: [String]?) throws -> [any EventRecord] {
    [event]
  }

  func event(withIdentifier identifier: String) -> (any EventRecord)? {
    identifier == event.id ? event : nil
  }

  func calendarItems(withExternalIdentifier identifier: String) -> [CalendarItemRecord] {
    requestedExternalIDs.append(identifier)
    if identifier == event.externalId { return [.event(event)] }
    if identifier == reminder.externalId { return [.reminder(reminder)] }
    return []
  }

  func makeEvent() -> any EventRecord {
    FakeDispatcherEvent(id: "EVT-NEW", calendar: calendar)
  }

  func save(_ event: any EventRecord, span: EventStoreSpan) throws {
    savedEventAvailabilities.append(event.availability.rawValue)
  }
  func remove(_ event: any EventRecord, span: EventStoreSpan) throws {}

  func reminderLists() -> [EventCalendar] { [reminderList] }

  func reminderList(withIdentifier identifier: String) -> EventCalendar? {
    identifier == reminderList.id ? reminderList : nil
  }

  func defaultReminderList() -> EventCalendar? { reminderList }

  func reminders(matching query: ReminderQuery) async throws -> [any ReminderRecord] {
    [reminder]
  }

  func reminder(withIdentifier identifier: String) -> (any ReminderRecord)? {
    identifier == reminder.id ? reminder : nil
  }

  func makeReminder() -> (any ReminderRecord)? {
    FakeDispatcherReminder(id: "REM-NEW", list: reminderList)
  }

  func save(_ reminder: any ReminderRecord) throws {}
  func remove(_ reminder: any ReminderRecord) throws {}
}

@MainActor private final class FakeDispatcherEvent: EventRecord {
  var id: String?
  let externalId: String? = "EXT-EVT-1"
  var title = "Planning"
  var start = Date(timeIntervalSince1970: 1_787_424_400)
  var end = Date(timeIntervalSince1970: 1_787_428_000)
  var isAllDay = false
  var calendar: EventCalendar?
  var location: String?
  var notes: String?
  var url: URL?
  var availability: EventAvailability = .busy
  let hasRecurrenceRules = false

  init(id: String = "EVT-1", calendar: EventCalendar) {
    self.id = id
    self.calendar = calendar
  }
}

@MainActor private final class FakeDispatcherReminder: ReminderRecord {
  var id: String?
  let externalId: String? = "EXT-REM-1"
  var title = "Buy milk"
  var list: EventCalendar?
  var isCompleted = false
  var completionDate: Date?
  var startDate: Date?
  var dueDate: Date?
  var priority = 0
  var notes: String?

  init(id: String = "REM-1", list: EventCalendar) {
    self.id = id
    self.list = list
  }
}
