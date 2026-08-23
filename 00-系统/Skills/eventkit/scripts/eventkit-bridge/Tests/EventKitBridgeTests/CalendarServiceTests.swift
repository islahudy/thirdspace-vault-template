import Foundation
import Testing
@testable import EventKitBridge

@MainActor @Suite struct CalendarServiceTests {
  @Test func listSortsEventsByStartDate() throws {
    let store = FakeEventStore(events: [.at("11:00"), .at("09:00")])

    let result = try CalendarService(store: store).list(
      .init(
        start: instant("2026-08-22T00:00:00+08:00"),
        end: instant("2026-08-23T00:00:00+08:00"),
        calendarIDs: nil
      )
    )

    #expect(result.map(\.title) == ["09:00", "11:00"])
  }

  @Test func eventDTOIncludesExternalIdentifierWhenAvailable() throws {
    let store = FakeEventStore(events: [.at("09:00", externalId: "EXT-EVT-1")])

    let result = try CalendarService(store: store).list(
      .init(
        start: instant("2026-08-22T00:00:00+08:00"),
        end: instant("2026-08-23T00:00:00+08:00"),
        calendarIDs: nil
      )
    )

    #expect(result.first?.externalId == "EXT-EVT-1")
  }

  @Test func createUsesRequestedWritableCalendar() throws {
    let work = EventCalendar(id: "work", title: "Work", isWritable: true)
    let store = FakeEventStore(calendars: [work])

    let result = try CalendarService(store: store).create(
      .init(
        title: "Planning",
        start: instant("2026-08-22T09:00:00+08:00"),
        end: instant("2026-08-22T10:00:00+08:00"),
        calendarID: "work"
      )
    )

    #expect(result.calendar.id == "work")
    #expect(store.defaultCalendarRequests == 0)
  }

  @Test func createUsesDefaultCalendarWhenNoCalendarIsRequested() throws {
    let personal = EventCalendar(id: "personal", title: "Personal", isWritable: true)
    let store = FakeEventStore(calendars: [personal], defaultCalendarID: "personal")

    let result = try CalendarService(store: store).create(
      .init(
        title: "Lunch",
        start: instant("2026-08-22T12:00:00+08:00"),
        end: instant("2026-08-22T13:00:00+08:00")
      )
    )

    #expect(result.calendar.id == "personal")
    #expect(store.defaultCalendarRequests == 1)
  }

  @Test func createRejectsAnInvalidDateRange() throws {
    let calendar = EventCalendar(id: "work", title: "Work", isWritable: true)
    let store = FakeEventStore(calendars: [calendar])

    let failure = try bridgeFailure {
      _ = try CalendarService(store: store).create(
        .init(
          title: "Impossible",
          start: instant("2026-08-22T10:00:00+08:00"),
          end: instant("2026-08-22T10:00:00+08:00"),
          calendarID: "work"
        )
      )
    }

    #expect(failure.error.code == .invalidDateRange)
    #expect(store.savedEvents.isEmpty)
  }

  @Test func updateFetchesTheEventByIdentifier() throws {
    let event = FakeEvent.at("09:00", id: "EVT-1", externalId: "EXT-EVT-1")
    let store = FakeEventStore(events: [event])

    let result = try CalendarService(store: store).update(
      id: "EVT-1",
      externalId: "EXT-EVT-1",
      request: .init(title: "Updated")
    )

    #expect(store.requestedEventIDs == ["EVT-1"])
    #expect(store.requestedExternalIDs.isEmpty)
    #expect(result.title == "Updated")
  }

  @Test func staleIdentifierFallsBackToOneExternalEvent() throws {
    let event = FakeEvent.at("09:00", id: "EVT-NEW", externalId: "EXT-EVT-1")
    let store = FakeEventStore(events: [event])

    let result = try CalendarService(store: store).update(
      id: "EVT-STALE",
      externalId: "EXT-EVT-1",
      request: .init(title: "Updated")
    )

    #expect(store.requestedEventIDs == ["EVT-STALE"])
    #expect(store.requestedExternalIDs == ["EXT-EVT-1"])
    #expect(result.id == "EVT-NEW")
    #expect(store.savedEvents.map(\.id) == ["EVT-NEW"])
  }

  @Test func zeroExternalEventMatchesRetainNotFound() throws {
    let store = FakeEventStore()

    let failure = try bridgeFailure {
      _ = try CalendarService(store: store).get(id: "EVT-STALE", externalId: "EXT-MISSING")
    }

    #expect(failure.error.code == .eventNotFound)
    #expect(store.requestedExternalIDs == ["EXT-MISSING"])
  }

  @Test func multipleExternalEventMatchesFailWithoutMutation() throws {
    let store = FakeEventStore(events: [
      .at("09:00", id: "EVT-A", externalId: "EXT-DUPLICATE"),
      .at("10:00", id: "EVT-B", externalId: "EXT-DUPLICATE"),
    ])

    let failure = try bridgeFailure {
      _ = try CalendarService(store: store).update(
        id: "EVT-STALE",
        externalId: "EXT-DUPLICATE",
        request: .init(title: "Must not change")
      )
    }

    #expect(failure.error.code == .eventKitError)
    #expect(failure.error.message == "Multiple Calendar events share the external identifier.")
    #expect(store.savedEvents.isEmpty)
  }

  @Test func deleteFetchesTheEventByIdentifier() throws {
    let event = FakeEvent.at("09:00", id: "EVT-1")
    let store = FakeEventStore(events: [event])

    try CalendarService(store: store).delete(id: "EVT-1", span: nil)

    #expect(store.requestedEventIDs == ["EVT-1"])
    #expect(store.removedEvents.map(\.id) == ["EVT-1"])
  }

  @Test func recurringUpdateRequiresASpanBeforeSaving() throws {
    let event = FakeEvent.at("09:00", id: "EVT-1", hasRecurrenceRules: true)
    let store = FakeEventStore(events: [event])

    let failure = try bridgeFailure {
      _ = try CalendarService(store: store).update(id: "EVT-1", request: .init(title: "Updated"))
    }

    #expect(failure.error.code == .recurringEventRequiresSpan)
    #expect(store.savedEvents.isEmpty)
  }

  @Test func recurringDeleteRequiresASpanBeforeRemoving() throws {
    let event = FakeEvent.at("09:00", id: "EVT-1", hasRecurrenceRules: true)
    let store = FakeEventStore(events: [event])

    let failure = try bridgeFailure {
      try CalendarService(store: store).delete(id: "EVT-1", span: nil)
    }

    #expect(failure.error.code == .recurringEventRequiresSpan)
    #expect(store.removedEvents.isEmpty)
  }

  @Test func updateMapsThisEventToTheStoreSpan() throws {
    let event = FakeEvent.at("09:00", id: "EVT-1", hasRecurrenceRules: true)
    let store = FakeEventStore(events: [event])

    _ = try CalendarService(store: store).update(
      id: "EVT-1",
      request: .init(title: "Updated", span: .thisEvent)
    )

    #expect(store.savedEvents.map(\.span) == [.thisEvent])
  }

  @Test func deleteMapsFutureEventsToTheStoreSpan() throws {
    let event = FakeEvent.at("09:00", id: "EVT-1", hasRecurrenceRules: true)
    let store = FakeEventStore(events: [event])

    try CalendarService(store: store).delete(id: "EVT-1", span: .futureEvents)

    #expect(store.removedEvents.map(\.span) == [.futureEvents])
  }

  @Test func createRejectsAReadOnlyCalendar() throws {
    let readOnly = EventCalendar(id: "subscribed", title: "Subscribed", isWritable: false)
    let store = FakeEventStore(calendars: [readOnly])

    let failure = try bridgeFailure {
      _ = try CalendarService(store: store).create(
        .init(
          title: "Cannot save",
          start: instant("2026-08-22T09:00:00+08:00"),
          end: instant("2026-08-22T10:00:00+08:00"),
          calendarID: "subscribed"
        )
      )
    }

    #expect(failure.error.code == .readOnlyCalendar)
    #expect(store.savedEvents.isEmpty)
  }
}

@MainActor private final class FakeEventStore: EventStoreClient {
  var events: [FakeEvent]
  var calendarsByID: [String: EventCalendar]
  let defaultCalendarID: String?
  private(set) var requestedEventIDs: [String] = []
  private(set) var requestedExternalIDs: [String] = []
  private(set) var defaultCalendarRequests = 0
  private(set) var savedEvents: [(id: String, span: EventStoreSpan)] = []
  private(set) var removedEvents: [(id: String, span: EventStoreSpan)] = []

  init(
    events: [FakeEvent] = [],
    calendars: [EventCalendar] = [],
    defaultCalendarID: String? = nil
  ) {
    self.events = events
    self.calendarsByID = Dictionary(uniqueKeysWithValues: calendars.map { ($0.id, $0) })
    self.defaultCalendarID = defaultCalendarID
  }

  func calendars() throws -> [EventCalendar] {
    Array(calendarsByID.values)
  }

  func calendar(withIdentifier identifier: String) -> EventCalendar? {
    calendarsByID[identifier]
  }

  func defaultCalendarForNewEvents() -> EventCalendar? {
    defaultCalendarRequests += 1
    guard let defaultCalendarID else { return nil }
    return calendarsByID[defaultCalendarID]
  }

  func events(start: Date, end: Date, calendarIDs: [String]?) throws -> [any EventRecord] {
    events
  }

  func event(withIdentifier identifier: String) -> (any EventRecord)? {
    requestedEventIDs.append(identifier)
    return events.first { $0.id == identifier }
  }

  func calendarItems(withExternalIdentifier identifier: String) -> [CalendarItemRecord] {
    requestedExternalIDs.append(identifier)
    return events.filter { $0.externalId == identifier }.map(CalendarItemRecord.event)
  }

  func makeEvent() -> any EventRecord {
    FakeEvent(
      id: nil,
      externalId: nil,
      title: "",
      start: Date.distantPast,
      end: Date.distantFuture,
      isAllDay: false,
      calendar: nil,
      location: nil,
      notes: nil,
      url: nil,
      availability: .busy,
      hasRecurrenceRules: false
    )
  }

  func save(_ event: any EventRecord, span: EventStoreSpan) throws {
    guard let event = event as? FakeEvent else { throw FakeStoreError.unexpectedEvent }
    if event.id == nil { event.id = "NEW-\(savedEvents.count + 1)" }
    savedEvents.append((id: event.id!, span: span))
  }

  func remove(_ event: any EventRecord, span: EventStoreSpan) throws {
    guard let event = event as? FakeEvent, let id = event.id else {
      throw FakeStoreError.unexpectedEvent
    }
    removedEvents.append((id: id, span: span))
  }
}

@MainActor private final class FakeEvent: EventRecord {
  var id: String?
  let externalId: String?
  var title: String
  var start: Date
  var end: Date
  var isAllDay: Bool
  var calendar: EventCalendar?
  var location: String?
  var notes: String?
  var url: URL?
  var availability: EventAvailability
  let hasRecurrenceRules: Bool

  init(
    id: String?,
    externalId: String?,
    title: String,
    start: Date,
    end: Date,
    isAllDay: Bool,
    calendar: EventCalendar?,
    location: String?,
    notes: String?,
    url: URL?,
    availability: EventAvailability,
    hasRecurrenceRules: Bool
  ) {
    self.id = id
    self.externalId = externalId
    self.title = title
    self.start = start
    self.end = end
    self.isAllDay = isAllDay
    self.calendar = calendar
    self.location = location
    self.notes = notes
    self.url = url
    self.availability = availability
    self.hasRecurrenceRules = hasRecurrenceRules
  }

  static func at(
    _ hourAndMinute: String,
    id: String? = nil,
    externalId: String? = nil,
    hasRecurrenceRules: Bool = false
  ) -> FakeEvent {
    let start = instant("2026-08-22T\(hourAndMinute):00+08:00")
    return .init(
      id: id ?? "EVT-\(hourAndMinute)",
      externalId: externalId,
      title: hourAndMinute,
      start: start,
      end: start.addingTimeInterval(60 * 60),
      isAllDay: false,
      calendar: EventCalendar(id: "work", title: "Work", isWritable: true),
      location: nil,
      notes: nil,
      url: nil,
      availability: .busy,
      hasRecurrenceRules: hasRecurrenceRules
    )
  }
}

private enum FakeStoreError: Error {
  case unexpectedEvent
}

private func instant(_ value: String) -> Date {
  try! DateCodec.parseInstant(value)
}

private enum CalendarServiceTestError: Error {
  case expectedBridgeFailure
}

private func bridgeFailure(_ operation: () throws -> Void) throws -> BridgeFailure {
  do {
    try operation()
    throw CalendarServiceTestError.expectedBridgeFailure
  } catch let failure as BridgeFailure {
    return failure
  }
}
